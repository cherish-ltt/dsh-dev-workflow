import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Context, Service } from "@deepseek-ai/cordis";
import { AttachmentStore, AttachmentError } from "@deepseek-ai/dsh-attachment";
import CommandRuntime from "@deepseek-ai/dsh-commands";
import { SessionStore } from "@deepseek-ai/dsh-session";
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";
import * as workflow from "../lib/index.js";

const image = {
	type: "image", mediaType: "image/png", name: "screen.png",
	data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
};
const imageBytes = Buffer.from(image.data, "base64");
const fileBytes = Buffer.from("# Requirement\nKeep the attached screenshot.\n");
const file = {
	attachmentId: createHash("sha256").update(fileBytes).digest("hex"),
	name: "requirement.md", bytes: fileBytes.length,
};
const submitted = [{ type: "file", receiptId: "uploaded-file" }, image];
const accept = "是 — 意图正确，开始执行";
const redo = "否 — 意图不正确，我要补充说明后重新分析";
const supplement = "是 + 补充 — 补充说明后直接开工（不重新复述）";
const answer = (label, custom = "") => (request) => ({
	answers: [{ id: request.questions[0].id, selected: label ? [label] : [], custom }],
});

// Native admission policy with in-memory bytes; raster decoding belongs to the host backend.
class MemoryAttachments extends AttachmentStore {
	imageLimits = { maxImagesPerMessage: 1, maxMessageImageBytes: 1024, mediaTypes: ["image/png"] };
	writes = 0;
	images = new Map();
	async validateImage(input) { assert.deepEqual(Buffer.from(input.data), imageBytes); }
	async saveImage(input) {
		this.writes += 1;
		const ref = {
			attachmentId: createHash("sha256").update(input.data).digest("hex"),
			mediaType: input.mediaType, bytes: input.data.length, width: 1, height: 1, name: input.name,
		};
		this.images.set(ref.attachmentId, input.data);
		return ref;
	}
}

class Questions extends Service {
	constructor(ctx) { super(ctx, "userQuestions"); }
	async ask(request) {
		request.agent.asked.push(request.questions);
		const next = request.agent.answers.shift();
		assert.ok(next, `unexpected question: ${request.questions[0].question}`);
		return next(request);
	}
}

const root = new Context();
try {
	await root.plugin(CommandRuntime);
	await root.plugin(SessionStore);
	await root.plugin(SystemPrompt);
	await root.plugin(ToolRuntime);
	const store = root.plugin(MemoryAttachments);
	await store;
	const questions = root.plugin(Questions);
	await questions;
	await root.plugin(workflow);
	const receipts = new WeakMap();
	root.commands.registerFileReceiptResolver((agent, receipt) => receipts.get(agent.session)?.get(receipt));

	function makeAgent(answers) {
		const agent = {
			session: root.sessions.create(undefined, { meta: { cwd: "/tmp" } }),
			status: "idle", sent: [], asked: [], answers: [...answers],
			followup(message) {
				this.sent.push(message);
				if (!message.content[0].text.startsWith("[pre-check]")) return;
				this.status = "running";
				root.emit("session/event", this.session, { type: "turn/start", data: { turn: this.sent.length } });
				root.emit("session/event", this.session, { type: "user/message", data: message });
				setTimeout(() => {
					this.status = "idle";
					root.emit("session/event", this.session, {
						type: "assistant/message", time: Date.now() + 1,
						data: { turn: this.sent.length, message: { content: [{ type: "text", text: `Report ${this.sent.length}` }] } },
					});
					root.emit("session/event", this.session, { type: "turn/end", data: { turn: this.sent.length, reason: { kind: "completed" } } });
				}, 0);
			},
		};
		receipts.set(agent.session, new Map([["uploaded-file", file]]));
		return agent;
	}
	const run = (agent, line, attachments = submitted, signal = new AbortController().signal) =>
		root.commands.execute(agent, line, attachments, signal);

	for (const name of ["dev-pre-check", "dev-feat", "dev-fix", "dev-refactor", "dev-test"]) {
		const agent = makeAgent([answer(redo), answer(undefined, "Only change the layout"), answer(supplement), answer(undefined, "Keep the file content")]);
		const writes = root.attachments.writes;
		const { result } = await run(agent, `/${name} Use the attached materials`);
		assert.equal(result.kind, "success", result.text);
		assert.equal(root.commands.find(agent, name).input.attachments, true);
		assert.equal(agent.sent.length, 3);
		assert.match(agent.sent[1].content[0].text, /Only change the layout/u);
		assert.match(agent.sent[2].content[0].text, /Keep the file content/u);
		const blocks = agent.sent[0].content.slice(1);
		assert.deepEqual(blocks.map((block) => block.type), ["file", "image"]);
		assert.deepEqual(blocks[0].attachment, file);
		assert.deepEqual(Buffer.from(root.attachments.images.get(blocks[1].attachment.attachmentId)), imageBytes);
		for (const message of agent.sent) {
			assert.deepEqual(message.content.slice(1), blocks);
			assert.ok(!message.content[0].text.includes(image.data));
		}
		assert.equal(root.attachments.writes, writes + 1, "analysis, correction and execution reuse stored references");
		console.log(`PASS /${name} native attachments survive correction and supplementary confirmation in order`);
	}

	for (const attachments of [[image], [submitted[0]], []]) {
		const agent = makeAgent([answer(accept)]);
		const { result } = await run(agent, "/dev-feat Task", attachments);
		assert.equal(result.kind, "success", result.text);
		assert.deepEqual(agent.sent[0].content.slice(1).map((block) => block.type), attachments.map((block) => block.type));
		assert.deepEqual(agent.sent[1].content.slice(1), agent.sent[0].content.slice(1));
	}
	console.log("PASS image-only, file-only and existing text-only inputs");

	const onlyAttachments = makeAgent([answer(undefined, "Explain the materials"), answer(accept)]);
	assert.equal((await run(onlyAttachments, "/dev-pre-check")).result.kind, "success");
	assert.equal(onlyAttachments.asked[0][0].id, "task");
	assert.match(onlyAttachments.sent[0].content[0].text, /Explain the materials/u);
	assert.deepEqual(onlyAttachments.sent[1].content.slice(1), onlyAttachments.sent[0].content.slice(1));
	console.log("PASS attachment-only invocation asks for the task and retains materials");

	for (const name of ["dev-pre-check", "dev-feat", "dev-fix", "dev-refactor", "dev-test"]) {
		for (const cancelled of [false, true]) {
			const agent = makeAgent([answer(cancelled ? "取消" : undefined)]);
			await run(agent, `/${name}${cancelled ? " Task" : ""}`);
			assert.equal(agent.sent.length, cancelled ? 1 : 0);
		}
		const controller = new AbortController();
		const aborted = makeAgent([(request) => { controller.abort(); return answer(accept)(request); }]);
		await assert.rejects(run(aborted, `/${name} Task`, submitted, controller.signal), /abort/iu);
		assert.equal(aborted.sent.length, 1);
	}
	console.log("PASS every command preserves task cancellation, confirmation cancellation and abort boundaries");

	for (const [attachments, expected] of [
		[[image, image], /image-count limit/u],
		[[{ ...image, data: "not-base64" }], /canonical base64/u],
		[[{ ...image, mediaType: "image/gif" }], /not accepted/u],
	]) {
		const agent = makeAgent([]);
		const writes = root.attachments.writes;
		const { result } = await run(agent, "/dev-fix Task", attachments);
		assert.equal(result.kind, "error");
		assert.match(result.text, expected);
		assert.equal(root.attachments.writes, writes);
		assert.equal(agent.sent.length, 0);
	}
	const otherSession = makeAgent([]);
	receipts.delete(otherSession.session);
	const rejectedFile = await run(otherSession, "/dev-fix Task");
	assert.equal(rejectedFile.result.kind, "error");
	assert.match(rejectedFile.result.text, /receipt is unknown for this session/u);
	assert.equal(otherSession.sent.length, 0);
	console.log("PASS real registry rejects over-limit, invalid images and foreign-session file receipts before workflow entry");

	const writeFailure = root.attachments.saveImage;
	root.attachments.saveImage = async () => { throw new AttachmentError("Cannot store fixture", "ATTACHMENT_WRITE_FAILED"); };
	const failedStorage = makeAgent([]);
	assert.equal((await run(failedStorage, "/dev-fix Task", [image])).result.kind, "error");
	assert.equal(failedStorage.sent.length, 0);
	root.attachments.saveImage = writeFailure;
	await questions.dispose();
	const noUi = makeAgent([]);
	const noUiResult = await run(noUi, "/dev-fix Task");
	assert.equal(noUiResult.result.kind, "error");
	assert.match(noUiResult.result.text, /没有交互式界面/u);
	assert.equal(noUi.sent.length, 1);
	await root.plugin(Questions);
	const noProvider = makeAgent([() => { throw new UserQuestionError("No answerer", "NO_PROVIDER"); }]);
	assert.equal((await run(noProvider, "/dev-fix Task")).result.kind, "error");
	assert.equal(noProvider.sent.length, 1);
	await store.dispose();
	const missingStorage = makeAgent([]);
	const missing = await run(missingStorage, "/dev-fix Task");
	assert.equal(missing.result.kind, "error");
	assert.match(missing.result.text, /no attachment store/u);
	assert.equal(missingStorage.sent.length, 0);
	console.log("PASS storage errors, missing storage, missing question service and absent answerer fail explicitly without execution");
	console.log("\nALL PASS");
} finally {
	await root.fiber.dispose();
}
