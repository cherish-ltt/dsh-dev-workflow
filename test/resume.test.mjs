import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as nextTurn, setTimeout as delay } from "node:timers/promises";
import { Context, Service } from "@deepseek-ai/cordis";
import { AttachmentStore } from "@deepseek-ai/dsh-attachment";
import CommandRuntime from "@deepseek-ai/dsh-commands";
import FileSystem from "@deepseek-ai/dsh-fs";
import { createAssistantMessage, createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session, SessionStore } from "@deepseek-ai/dsh-session";
import SessionProjectionRegistry from "@deepseek-ai/dsh-session-projection";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";
import WorkingDirectory from "@deepseek-ai/dsh-working-directory";
import * as workflow from "../lib/index.js";

const ACCEPT = "是 — 意图正确，开始执行";
const REDO = "否 — 意图不正确，我要补充说明后重新分析";
const SUPPLEMENT = "是 + 补充 — 补充说明后直接开工（不重新复述）";
const TASK = "Implement the requested behavior";
const CWD = process.cwd();
const userMessage = (text, source = { kind: "user" }) =>
	createUserMessage({ content: [{ type: "text", text }], source });
const textOf = (message) => message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
const executions = (agent) => agent.sent.filter((message) => !textOf(message).startsWith("[pre-check]"));

class Questions extends Service {
	constructor(ctx) { super(ctx, "userQuestions"); }
	ask(request) {
		if (request.agent.noUi) throw new UserQuestionError("No answerer", "NO_PROVIDER");
		// Keep aborted requests answerable so late replies exercise the workflow's own guard.
		return new Promise((resolve, reject) => request.agent.questions.push({
			request, resolve,
			answer(label, custom = "") {
				resolve({ answers: [{ id: request.questions[0].id, selected: label ? [label] : [], custom }] });
			},
			escape() { reject(new UserQuestionError("Cancelled", "ASK_CANCELLED")); },
		}));
	}
}

const image = { type: "image", mediaType: "image/png", name: "screen.png", data: "AQID" };
const file = { attachmentId: "requirement-file", name: "requirement.md", bytes: 20 };
// Storage only verifies reference reuse; raster decoding belongs to the host backend.
class MemoryAttachments extends AttachmentStore {
	imageLimits = { maxImagesPerMessage: 1, maxMessageImageBytes: 1024, mediaTypes: ["image/png"] };
	writes = 0;
	async validateImage(input) { assert.deepEqual([...input.data], [1, 2, 3]); }
	async saveImage(input) {
		this.writes += 1;
		return { attachmentId: "screen-image", mediaType: input.mediaType, bytes: 3, width: 1, height: 1, name: input.name };
	}
}

test("confirmation recovery through native command and session services", async (t) => {
	const root = new Context();
	const agents = [];
	const operations = [];
	let plugin;
	let questions;

	function makeAgent({ session, analyze, noUi = false } = {}) {
		session ??= root.sessions.prepare(undefined, { meta: { cwd: CWD } });
		const detach = root.sessions.enter(session);
		root.sessions.announce(session);
		const agent = {
			session, detach, noUi, status: "idle", sent: [], questions: [], readQuestions: 0, analyses: 0,
			followup(message) {
				this.sent.push(message);
				session.append("agent/inbox/spliced", { target: "next-turn", start: 0, inserted: [message] });
				if (!textOf(message).startsWith("[pre-check]")) return;
				this.status = "running";
				const turn = ++this.analyses;
				session.append("turn/start", { turn });
				session.append("agent/inbox/spliced", { target: "next-turn", start: 0, removedCount: 1, inserted: [] });
				session.append("user/message", message, { surfaceOp: "append" });
				if (analyze) analyze(this, turn);
				else complete(this, turn);
			},
		};
		agents.push(agent);
		return agent;
	}

	function output(agent, turn, content, interrupted = false) {
		agent.session.append("assistant/message", {
			turn, step: 1, stream: [],
			message: createAssistantMessage({ content, source: { provider: "test", model: "test" } }),
			...(interrupted ? { interrupted: true } : {}),
		}, { surfaceOp: "append" });
	}
	function complete(agent, turn, text = `Full report ${turn} for ${agent.session.id}`) {
		output(agent, turn, [{ type: "text", text }]);
		agent.session.append("turn/end", { turn, reason: { kind: "completed" } });
		agent.status = "idle";
	}
	function start(agent, line, attachments = []) {
		const controller = new AbortController();
		const done = root.commands.execute(agent, line, attachments, controller.signal);
		done.catch(() => {});
		const operation = { controller, done };
		operations.push(operation);
		return operation;
	}
	async function question(agent) {
		const index = agent.readQuestions++;
		const deadline = Date.now() + 3000;
		while (!agent.questions[index]) {
			assert.ok(Date.now() < deadline, `question ${index + 1} did not arrive for ${agent.session.id}`);
			await delay(5);
		}
		return agent.questions[index];
	}
	async function suspend(agent, command = "dev-feat", task = TASK, attachments = []) {
		const operation = start(agent, `/${command} ${task}`, attachments);
		const old = await question(agent);
		assert.equal(old.request.questions[0].id, "intent-confirm");
		assert.equal(Object.hasOwn(old.request.questions[0], "detail"), false);
		assert.equal(Object.hasOwn(old.request.questions[0], "intent"), false);
		operation.controller.abort();
		await assert.rejects(operation.done, { name: "AbortError" });
		assert.equal(executions(agent).length, 0);
		return old;
	}
	async function noPending(agent) {
		const { result } = await start(agent, "/dev-resume").done;
		assert.equal(result.kind, "error");
		assert.match(result.text, /没有可恢复/u);
	}
	async function accept(agent, operation) {
		(await question(agent)).answer(ACCEPT);
		const { result } = await operation.done;
		assert.equal(result.kind, "success", result.text);
		assert.equal(executions(agent).length, 1);
		return textOf(executions(agent)[0]);
	}

	try {
		await root.plugin(CommandRuntime);
		await root.plugin(SessionStore);
		await root.plugin(SystemPrompt);
		await root.plugin(ToolRuntime);
		await root.plugin(SessionProjectionRegistry);
		await root.plugin(FileSystem);
		await root.plugin(WorkingDirectory, { defaultDirectory: CWD });
		await root.plugin(MemoryAttachments);
		questions = root.plugin(Questions);
		await questions;
		plugin = root.plugin(workflow);
		await plugin;
		root.commands.register({ name: "other-command", description: "Another native command", handler: () => ({ kind: "success", text: "done" }) });
		const receipts = new WeakMap();
		root.commands.registerFileReceiptResolver((agent, receiptId) => receipts.get(agent.session)?.get(receiptId));

		for (const [command, responsibility] of [
			["dev-pre-check", /\[execute\]/u],
			["dev-feat", /只实现任务要求的功能/u],
			["dev-fix", /定位根因/u],
			["dev-refactor", /重构前后对外行为与公共 API 签名完全一致/u],
			["dev-test", /覆盖成功路径、边界条件与错误分支/u],
		]) {
			await t.test(`${command}: fresh confirmation resumes original task and executes once`, async () => {
				const agent = makeAgent();
				const old = await suspend(agent, command);
				const report = `Full report 1 for ${agent.session.id}`;
				const resumed = start(agent, "/dev-resume");
				const fresh = await question(agent);
				assert.notEqual(fresh.request, old.request);
				assert.notEqual(fresh.request.signal, old.request.signal);
				assert.equal(old.request.signal.aborted, true);
				assert.equal(fresh.request.signal.aborted, false);
				const detail = fresh.request.questions[0].detail;
				assert.ok(detail.includes(`/${command}`) && detail.includes(TASK) && detail.includes(CWD));
				assert.match(detail, /报告生成时间：[\dT:.Z-]+/u);
				assert.match(detail, /主对话中的上次报告未重新核实/u);
				assert.ok(!JSON.stringify(fresh.request.questions).includes(report));
				assert.equal(Object.hasOwn(fresh.request.questions[0], "intent"), false);
				assert.equal(agent.analyses, 1);
				assert.equal(executions(agent).length, 0);
				fresh.answer(ACCEPT);
				assert.equal((await resumed.done).result.kind, "success");
				assert.equal(executions(agent).length, 1);
				const execution = textOf(executions(agent)[0]);
				assert.match(execution, responsibility);
				assert.ok(execution.includes(TASK) && execution.includes(report));
				await noPending(agent);
				old.answer(ACCEPT);
				await nextTurn();
				assert.equal(executions(agent).length, 1);
			});
		}

		for (const redoAgain of [false, true]) {
			await t.test(`redo preserves corrections and executes the latest report ${redoAgain ? "after another analysis" : "on resume"}`, async () => {
				const agent = makeAgent();
				const original = start(agent, `/dev-fix ${TASK}`);
				(await question(agent)).answer(REDO);
				(await question(agent)).answer(undefined, "Keep the public API");
				const second = await question(agent);
				assert.equal(Object.hasOwn(second.request.questions[0], "detail"), false);
				assert.match(textOf(agent.sent[1]), /Keep the public API/u);
				original.controller.abort();
				await assert.rejects(original.done, { name: "AbortError" });
				const resumed = start(agent, "/dev-resume");
				const fresh = await question(agent);
				assert.ok(!JSON.stringify(fresh.request.questions).includes("Full report"));
				let current = fresh;
				if (redoAgain) {
					fresh.answer(REDO);
					(await question(agent)).answer(undefined, "Only change the backend");
					current = await question(agent);
					assert.equal(Object.hasOwn(current.request.questions[0], "detail"), false);
					assert.match(textOf(agent.sent[2]), /Keep the public API[\s\S]*Only change the backend/u);
				}
				current.answer(ACCEPT);
				assert.equal((await resumed.done).result.kind, "success");
				const execution = textOf(executions(agent)[0]);
				assert.ok(execution.includes(`Full report ${redoAgain ? 3 : 2} for ${agent.session.id}`));
				assert.ok(!execution.includes(`Full report 1 for ${agent.session.id}`));
				if (redoAgain) assert.ok(!execution.includes(`Full report 2 for ${agent.session.id}`));
				assert.equal(agent.analyses, redoAgain ? 3 : 2);
				second.answer(ACCEPT);
				await nextTurn();
				assert.equal(executions(agent).length, 1);
			});
		}

		for (const direct of [false, true]) {
			await t.test(`resumed ${direct ? "custom answer" : "supplement"} is included without reanalysis`, async () => {
				const agent = makeAgent();
				await suspend(agent);
				const resumed = start(agent, "/dev-resume");
				const fresh = await question(agent);
				if (direct) fresh.answer(undefined, "Keep the existing layout");
				else {
					fresh.answer(SUPPLEMENT);
					(await question(agent)).answer(undefined, "Keep the existing layout");
				}
				assert.equal((await resumed.done).result.kind, "success");
				assert.equal(executions(agent).length, 1);
				assert.match(textOf(executions(agent)[0]), /用户补充[\s\S]*Keep the existing layout/u);
				assert.equal(agent.analyses, 1);
			});
		}

		for (const escape of [false, true]) {
			await t.test(`${escape ? "Esc" : "cancel"} clears recovery and late acceptance cannot revive it`, async () => {
				const agent = makeAgent();
				const old = await suspend(agent);
				const resumed = start(agent, "/dev-resume");
				const fresh = await question(agent);
				if (escape) fresh.escape();
				else fresh.answer("取消");
				assert.match((await resumed.done).result.text, /已取消/u);
				old.answer(ACCEPT);
				await nextTurn();
				await noPending(agent);
				assert.equal(executions(agent).length, 0);
			});
		}

		await t.test("late old answers cannot execute or clear new confirmations; concurrent resume rejects", async () => {
			const agent = makeAgent();
			const old = await suspend(agent);
			const firstResume = start(agent, "/dev-resume");
			const first = await question(agent);
			for (let pass = 0; pass < 2; pass += 1) {
				const rejected = await start(agent, "/dev-resume").done;
				assert.equal(rejected.result.kind, "error");
				assert.match(rejected.result.text, /已有确认流程/u);
				if (pass === 0) { old.answer("取消"); await nextTurn(); }
			}
			assert.equal(agent.questions.length, 2);
			assert.equal(first.request.signal.aborted, false);
			firstResume.controller.abort();
			await assert.rejects(firstResume.done, { name: "AbortError" });
			const secondResume = start(agent, "/dev-resume");
			const second = await question(agent);
			first.answer(ACCEPT);
			await nextTurn();
			assert.equal(executions(agent).length, 0);
			assert.equal(second.request.signal.aborted, false);
			second.answer(ACCEPT);
			assert.equal((await secondResume.done).result.kind, "success");
			assert.equal(executions(agent).length, 1);
			await noPending(agent);
		});

		await t.test("state belongs to the exact live Session and a new task replaces the previous task", async () => {
			const agent = makeAgent();
			const old = await suspend(agent, "dev-feat", "Old task");
			await noPending(makeAgent());
			const detached = { ...agent, session: Session.create(agent.session.id, undefined, agent.session.header) };
			await noPending(detached);
			const neighbor = makeAgent();
			neighbor.session.append("user/message", userMessage("Unrelated session input"), { surfaceOp: "append" });
			const ownResume = start(agent, "/dev-resume");
			const ownQuestion = await question(agent);
			assert.equal(agent.analyses, 1);
			ownResume.controller.abort();
			await assert.rejects(ownResume.done, { name: "AbortError" });
			const replacement = start(agent, "/dev-fix Replacement task");
			const replacementQuestion = await question(agent);
			old.answer(ACCEPT);
			ownQuestion.answer("取消");
			await nextTurn();
			assert.equal(executions(agent).length, 0);
			assert.equal(replacementQuestion.request.signal.aborted, false);
			replacement.controller.abort();
			await assert.rejects(replacement.done, { name: "AbortError" });
			const resumed = start(agent, "/dev-resume");
			const fresh = await question(agent);
			assert.match(fresh.request.questions[0].detail, /\/dev-fix[\s\S]*Replacement task/u);
			assert.ok(!fresh.request.questions[0].detail.includes("Old task"));
			fresh.answer(ACCEPT);
			assert.equal((await resumed.done).result.kind, "success");
			assert.match(textOf(executions(agent)[0]), /^\[dev-fix\] Replacement task/u);
			assert.equal(executions(agent).length, 1);
		});

		for (const [label, change] of [
			["user message", (agent) => agent.session.append("user/message", userMessage("New user input"), { surfaceOp: "append" })],
			["inbox user insertion", (agent) => agent.session.append("agent/inbox/spliced", { target: "next-step", start: 0, inserted: [userMessage("Queued input")] })],
			["late user-question reply", (agent) => agent.session.append("user/message", userMessage("Answer", { kind: "user-question-reply", callId: "question-1", outcome: "answered" }), { surfaceOp: "append" })],
			["other command", (agent) => start(agent, "/other-command").done],
			["cwd change", (agent) => agent.session.append("working-directory/change", { cwd: `${CWD}/test` })],
		]) {
			await t.test(`${label} forces reanalysis before fresh confirmation`, async () => {
				const agent = makeAgent();
				await suspend(agent);
				await change(agent);
				const resumed = start(agent, "/dev-resume");
				const fresh = await question(agent);
				assert.equal(agent.analyses, 2);
				assert.equal(Object.hasOwn(fresh.request.questions[0], "detail"), false);
				assert.ok(!JSON.stringify(fresh.request.questions).includes("Full report"));
				assert.equal(executions(agent).length, 0);
				fresh.answer(ACCEPT);
				assert.equal((await resumed.done).result.kind, "success");
				assert.equal(executions(agent).length, 1);
				const execution = textOf(executions(agent)[0]);
				assert.ok(execution.includes(`Full report 2 for ${agent.session.id}`));
				assert.ok(!execution.includes(`Full report 1 for ${agent.session.id}`));
			});
		}

		await t.test("cwd changed while answering prevents execution and remains recoverable for reanalysis", async () => {
			const agent = makeAgent();
			await suspend(agent);
			const resumed = start(agent, "/dev-resume");
			const fresh = await question(agent);
			agent.session.append("working-directory/change", { cwd: `${CWD}/test` });
			fresh.answer(ACCEPT);
			assert.equal((await resumed.done).result.kind, "error");
			assert.equal(executions(agent).length, 0);
			await accept(agent, start(agent, "/dev-resume"));
			assert.equal(agent.analyses, 2);
		});

		await t.test("user inbox insertion during confirmation invalidates the active answer", async () => {
			const agent = makeAgent();
			await suspend(agent);
			const resumed = start(agent, "/dev-resume");
			const stale = await question(agent);
			agent.session.append("agent/inbox/spliced", { target: "next-step", start: 0, inserted: [userMessage("Changed requirement")] });
			assert.equal(stale.request.signal.aborted, true);
			const refreshed = start(agent, "/dev-resume");
			const fresh = await question(agent);
			stale.answer(ACCEPT);
			assert.equal((await resumed.done).result.kind, "error");
			assert.equal(executions(agent).length, 0);
			assert.equal(fresh.request.signal.aborted, false);
			assert.equal(agent.analyses, 2);
			fresh.answer(ACCEPT);
			assert.equal((await refreshed.done).result.kind, "success");
			assert.equal(executions(agent).length, 1);
		});

		await t.test("runtime-context messages and inbox updates do not invalidate a report", async () => {
			const agent = makeAgent();
			await suspend(agent);
			agent.session.append("user/message", userMessage("Runtime context", { kind: "runtime-context" }), { surfaceOp: "append" });
			const resumed = start(agent, "/dev-resume");
			const fresh = await question(agent);
			agent.session.append("agent/inbox/spliced", { target: "next-step", start: 0, inserted: [userMessage("Another context", { kind: "runtime-context" })] });
			assert.equal(fresh.request.signal.aborted, false);
			fresh.answer(ACCEPT);
			assert.equal((await resumed.done).result.kind, "success");
			assert.equal(agent.analyses, 1);
			assert.equal(executions(agent).length, 1);
		});

		await t.test("completed report survives abort before the next wait poll", async () => {
			let original;
			const agent = makeAgent({ analyze(agent, turn) {
				setImmediate(() => { complete(agent, turn); original.controller.abort(); });
			} });
			original = start(agent, `/dev-feat ${TASK}`);
			await assert.rejects(original.done, { name: "AbortError" });
			assert.equal(agent.questions.length, 0);
			assert.equal(executions(agent).length, 0);
			await accept(agent, start(agent, "/dev-resume"));
			assert.equal(agent.analyses, 1);
		});

		for (const [label, reason, content, interrupted] of [
			["interrupted prefix", { kind: "aborted", reason: { kind: "user" } }, [{ type: "text", text: "Partial report" }], true],
			["max-token output", { kind: "max-tokens" }, [{ type: "text", text: "Truncated report" }]],
			["failed turn", { kind: "error", error: { message: "Failed", code: "UNKNOWN" } }, [{ type: "text", text: "Unfinished report" }]],
			["tool-call output", { kind: "completed" }, [{ type: "text", text: "Still exploring" }, { type: "tool-call", id: "read-1", name: "read", arguments: "{}" }]],
			["empty completed output", { kind: "completed" }, []],
			["unclosed turn", undefined, [{ type: "text", text: "No completed turn" }]],
		]) {
			await t.test(`${label} cannot become a recoverable complete report`, async () => {
				const agent = makeAgent({ analyze(agent, turn) {
					output(agent, turn, content, interrupted);
					if (reason) agent.session.append("turn/end", { turn, reason });
					agent.status = "idle";
				} });
				const original = start(agent, `/dev-feat ${TASK}`);
				await delay(550);
				original.controller.abort();
				await assert.rejects(original.done, { name: "AbortError" });
				assert.equal(agent.questions.length, 0);
				await noPending(agent);
				assert.equal(executions(agent).length, 0);
			});
		}

		await t.test("another turn's completed report cannot confirm this task", async () => {
			const agent = makeAgent({ analyze(agent, turn) { complete(agent, turn + 10, "Unrelated report"); } });
			const original = start(agent, `/dev-feat ${TASK}`);
			await delay(550);
			original.controller.abort();
			await assert.rejects(original.done, { name: "AbortError" });
			assert.equal(agent.questions.length, 0);
			await noPending(agent);
		});

		await t.test("aborting a redo before its report completes cannot restore the previous report", async () => {
			const agent = makeAgent({ analyze(agent, turn) {
				if (turn === 1) complete(agent, turn);
			} });
			const original = start(agent, `/dev-feat ${TASK}`);
			(await question(agent)).answer(REDO);
			(await question(agent)).answer(undefined, "Replace the original design");
			await nextTurn();
			assert.equal(agent.analyses, 2);
			original.controller.abort();
			await assert.rejects(original.done, { name: "AbortError" });
			await noPending(agent);
			assert.equal(executions(agent).length, 0);
		});

		for (const missingService of [false, true]) {
			await t.test(`${missingService ? "missing question service" : "NO_PROVIDER"} prevents execution but retains a completed report`, async () => {
				const agent = makeAgent({ noUi: !missingService });
				if (missingService) await questions.dispose();
				try {
					const { result } = await start(agent, `/dev-feat ${TASK}`).done;
					assert.equal(result.kind, "error");
					assert.match(result.text, /没有交互式界面/u);
					assert.equal(executions(agent).length, 0);
				} finally {
					if (missingService) { questions = root.plugin(Questions); await questions; }
				}
				agent.noUi = false;
				await accept(agent, start(agent, "/dev-resume"));
				assert.equal(agent.analyses, 1);
			});
		}

		await t.test("native image and file references survive recovery without another upload", async () => {
			const agent = makeAgent();
			receipts.set(agent.session, new Map([["file-receipt", file]]));
			const writes = root.attachments.writes;
			await suspend(agent, "dev-feat", TASK, [{ type: "file", receiptId: "file-receipt" }, image]);
			await accept(agent, start(agent, "/dev-resume"));
			assert.deepEqual(agent.sent[0].content.slice(1).map((block) => block.type), ["file", "image"]);
			assert.deepEqual(executions(agent)[0].content.slice(1), agent.sent[0].content.slice(1));
			assert.equal(root.attachments.writes, writes + 1);
		});

		await t.test("resume rejects new task arguments without consuming the pending report", async () => {
			const agent = makeAgent();
			await suspend(agent);
			const { result } = await start(agent, "/dev-resume Different task").done;
			assert.equal(result.kind, "error");
			assert.match(result.text, /不接受新任务文字/u);
			await accept(agent, start(agent, "/dev-resume"));
			assert.equal(agent.analyses, 1);
		});

		await t.test("session detach clears pending state, including after a same-id session is recreated", async () => {
			const agent = makeAgent();
			const old = await suspend(agent);
			agent.detach();
			await noPending(agent);
			old.answer(ACCEPT);
			await nextTurn();
			assert.equal(executions(agent).length, 0);
			const replacement = makeAgent({ session: root.sessions.prepare(agent.session.id, { meta: { cwd: CWD } }) });
			await noPending(replacement);
		});

		await t.test("detaching a session aborts its active confirmation", async () => {
			const agent = makeAgent();
			const original = start(agent, `/dev-feat ${TASK}`);
			const active = await question(agent);
			agent.detach();
			assert.equal(active.request.signal.aborted, true);
			active.answer(ACCEPT);
			assert.equal((await original.done).result.kind, "error");
			await noPending(agent);
			assert.equal(executions(agent).length, 0);
		});

		await t.test("plugin unload aborts active confirmation and a remount does not restore memory", async () => {
			const agent = makeAgent();
			const original = start(agent, `/dev-feat ${TASK}`);
			const old = await question(agent);
			await plugin.dispose();
			assert.equal(old.request.signal.aborted, true);
			assert.equal(root.commands.find(agent, "dev-resume"), undefined);
			old.answer(ACCEPT);
			assert.equal((await original.done).result.kind, "error");
			assert.equal(executions(agent).length, 0);
			plugin = root.plugin(workflow);
			await plugin;
			await noPending(agent);
		});

		await t.test("32 completed pending sessions are retained and the next one evicts only the oldest", async () => {
			const batch = Array.from({ length: 32 }, () => makeAgent({ noUi: true }));
			const completed = await Promise.all(batch.map((agent) => start(agent, `/dev-feat ${TASK}`).done));
			for (const { result } of completed) assert.match(result.text, /没有交互式界面/u);
			const newest = makeAgent({ noUi: true });
			assert.match((await start(newest, `/dev-feat ${TASK}`).done).result.text, /没有交互式界面/u);
			await noPending(batch[0]);
			const retained = await Promise.all([...batch.slice(1), newest].map((agent) => start(agent, "/dev-resume").done));
			for (const { result } of retained) assert.match(result.text, /没有交互式界面/u);
			newest.noUi = false;
			await accept(newest, start(newest, "/dev-resume"));
			assert.equal(newest.analyses, 1);
		});
	} finally {
		for (const operation of operations) operation.controller.abort();
		for (const agent of agents) for (const pending of agent.questions) pending.resolve(undefined);
		await Promise.allSettled(operations.map((operation) => operation.done));
		await nextTurn();
		for (const agent of agents) agent.detach();
		await root.fiber.dispose();
	}
});
