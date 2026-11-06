/**
 * 意图确认：从 pi-dev-workflow 的 extensions/pre-check.ts 移植。
 *
 * 代理先只读探查并复述意图，用户确认后才真正执行。
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { buildExecutionPrompt, buildPreCheckPrompt } from "./prompts.js";
import { extractMessageText, NoAnswererError, readAnswer, tryAsk } from "./ask.js";
import { loadPromptCheck } from "./skills.js";
import { projectCwd } from "./session-utils.js";

const PRE_CHECK_TIMEOUT_MS = 20 * 60_000;
const PRE_CHECK_MAX_WAIT_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 500;

/** 命令中断：宿主中止了本次命令，不能当作「用户取消」静默结束。 */
export class PreCheckAbortedError extends Error {
	constructor() {
		super("命令已被宿主中断，意图确认未完成");
		this.name = "PreCheckAbortedError";
	}
}

export class PreCheckChangedError extends Error {
	constructor() {
		super("工作目录或会话输入已变化，请运行 /dev-resume 重新分析后再确认");
		this.name = "PreCheckChangedError";
	}
}

export function checkConfirmation(signal, pending) {
	if (signal?.aborted) throw new PreCheckAbortedError();
	pending?.assertCurrent();
	if (pending?.changed()) throw new PreCheckChangedError();
}

const OPT_ACCEPT = "是 — 意图正确，开始执行";
const OPT_ACCEPT_WITH_NOTE = "是 + 补充 — 补充说明后直接开工（不重新复述）";
const OPT_REDO = "否 — 意图不正确，我要补充说明后重新分析";
const OPT_CANCEL = "取消";

const CONFIRM_ID = "intent-confirm";
const NOTE_ID = "intent-note";

function sleep(ms, signal) {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(finish, ms);
		function finish() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", finish);
			resolve();
		}
		signal?.addEventListener("abort", finish, { once: true });
	});
}

function withSupplement(intent, supplement) {
	return [intent, "", "### 用户补充（已确认，直接采纳，不需重新复述）", supplement].join("\n");
}

/** 只接纳本次输入所属轮次成功结束时的最终文本，排除中断和工具调用中的片段。 */
function trackRestatement(ctx, session, messageId, signal, saveReport) {
	let openTurn;
	let targetTurn;
	let text;
	let completed;
	const dispose = ctx.on("session/event", (subject, event) => {
		if (subject !== session || signal?.aborted) return;
		if (event.type === "turn/start") openTurn = event.data.turn;
		if (event.type === "user/message" && event.data.id === messageId) targetTurn = openTurn;
		if (targetTurn === undefined || event.data.turn !== targetTurn) return;
		if (event.type === "assistant/message") {
			const { message, interrupted } = event.data;
			text = interrupted || message.content.some((block) => block.type === "tool-call")
				? undefined : extractMessageText(message.content);
		}
		if (event.type === "turn/end" && event.data.reason.kind === "completed" && text) {
			completed = text;
			saveReport?.(text);
		}
	}, { global: true });
	return { read: () => completed, dispose };
}

/**
 * 等待本轮复述产物：代理忙碌（正在执行工具、或在 dev_ask 上等用户作答）期间不计超时。
 * 同时保留一个绝对上限，避免代理一直不空闲时无限等待。
 */
async function waitForRestatement(ctx, agent, message, signal, pending) {
	const tracker = trackRestatement(ctx, agent.session, message.id, signal, pending?.saveReport);
	const startedAt = Date.now();
	let deadline = startedAt + PRE_CHECK_TIMEOUT_MS;

	try {
		agent.followup(message);
		for (;;) {
			if (signal?.aborted) return undefined;
			if (Date.now() - startedAt > PRE_CHECK_MAX_WAIT_MS) return undefined;

			if (agent.status === "idle") {
				const text = tracker.read();
				if (text) return text;
				if (Date.now() > deadline) return undefined;
			} else {
				deadline = Date.now() + PRE_CHECK_TIMEOUT_MS;
			}

			await sleep(POLL_INTERVAL_MS, signal);
		}
	} finally {
		tracker.dispose();
	}
}

/** 用户对复述的选择；undefined 表示放弃。 */
async function resolveDecision(ctx, agent, intent, signal, pending) {
	for (;;) {
		const answer = await tryAsk(
			ctx,
			[
				{
					id: CONFIRM_ID,
					header: "意图确认",
					question: "意图确认：以上复述是否准确反映你的目标？",
					...(pending?.resumed ? { detail: [
						`原命令：/${pending.state.command}`,
						`原始任务：${pending.state.task}`,
						`工作目录：${pending.state.cwd}`,
						`报告生成时间：${new Date(pending.state.generatedAt).toISOString()}`,
						"主对话中的上次报告未重新核实；需要更新时请选择「否」重新分析。",
					].join("\n\n") } : {}),
					options: [
						{ label: OPT_ACCEPT, description: "复述准确，直接开始执行" },
						{ label: OPT_ACCEPT_WITH_NOTE, description: "复述基本正确，补充后直接开工" },
						{ label: OPT_REDO, description: "复述有偏差，补充说明后重新分析" },
						{ label: OPT_CANCEL, description: "放弃本次任务，不做任何改动" },
					],
				},
			],
			{ agent, signal },
		);

		checkConfirmation(signal, pending);
		if (answer === undefined) return undefined;

		const picked = readAnswer(answer, CONFIRM_ID);
		if (picked.custom !== undefined) {
			// 直接打字作答视同补充说明后开工，避免用户在确认卡上白写一段话
			return { intent: withSupplement(intent, picked.custom) };
		}
		if (picked.label === undefined || picked.label === OPT_CANCEL) return undefined;
		if (picked.label === OPT_ACCEPT) return { intent };

		const supplement = picked.label === OPT_ACCEPT_WITH_NOTE;
		const noteAnswer = await tryAsk(
			ctx,
			[
				{
					id: NOTE_ID,
					header: supplement ? "补充说明" : "修正说明",
					question: supplement ? "补充说明（并入意图，不重新复述）" : "补充/修正说明",
				},
			],
			{ agent, signal },
		);
		checkConfirmation(signal, pending);
		if (noteAnswer === undefined) continue;

		const text = readAnswer(noteAnswer, NOTE_ID).custom ?? "";
		if (supplement) return { intent: withSupplement(intent, text) };
		return { correction: text || "（用户未提供具体说明，请重新检查复述）" };
	}
}

/**
 * 意图确认循环：让代理复述 → 用户确认 → 必要时带修正重来。
 * @returns 已确认的意图文本；undefined 表示用户取消。
 */
export async function confirmIntent(task, ctx, agent, signal, notices, attachments = [], pending) {
	const corrections = pending?.state.corrections ?? [];
	let intent = pending?.state.intent;
	if (pending?.changed()) {
		notices.push("工作目录或会话输入已变化，重新分析后再确认。");
		intent = undefined;
	}

	for (;;) {
		pending?.assertCurrent();
		if (!intent) {
			if (pending) {
				pending.resumed = false;
				pending.state.intent = undefined;
				pending.state.changed = false;
				pending.state.cwd = projectCwd(ctx, agent);
			}
			let guidance;
			try {
				guidance = await loadPromptCheck(ctx, agent, signal);
			} catch (error) {
				if (signal?.aborted) throw new PreCheckAbortedError();
				throw error;
			}
			if (guidance.warning) notices.push(guidance.warning);
			notices.push("正在让代理复述任务意图（只分析，不执行）...");
			checkConfirmation(signal, pending);

			const message = createUserMessage({
				content: [{ type: "text", text: buildPreCheckPrompt(task, corrections, guidance) }, ...attachments],
				source: { kind: "user" },
			});
			if (pending) pending.state.messageId = message.id;

			intent = await waitForRestatement(ctx, agent, message, signal, pending);
			if (!intent) {
				if (signal?.aborted) throw new PreCheckAbortedError();
				const retry = await tryAsk(
					ctx,
					[
						{
							id: CONFIRM_ID,
							header: "未获取到复述",
							question: "未获取到代理的意图复述",
							options: [
								{ label: "重试", description: "重新让代理复述一次" },
								{ label: OPT_CANCEL, description: "放弃本次任务" },
							],
						},
					],
					{ agent, signal },
				);
				checkConfirmation(signal, pending);
				if (retry !== undefined && readAnswer(retry, CONFIRM_ID).label === "重试") continue;
				return undefined;
			}
			checkConfirmation(signal, pending);
		}

		checkConfirmation(signal, pending);
		const decision = await resolveDecision(ctx, agent, intent, signal, pending);
		checkConfirmation(signal, pending);
		if (decision === undefined) return undefined;
		if (decision.intent !== undefined) return decision.intent;
		corrections.push(decision.correction);
		intent = undefined;
	}
}

/** 读取待校验需求原文：优先命令参数，其次自由输入。 */
async function readTask(ctx, agent, args, signal) {
	const given = args.trim();
	if (given) return given;

	const answer = await tryAsk(
		ctx,
		[
			{
				id: "task",
				header: "待校验需求",
				question: "待校验的需求（原始 prompt）",
			},
		],
		{ agent, signal },
	);
	if (answer === undefined) {
		if (signal?.aborted) throw new PreCheckAbortedError();
		return undefined;
	}

	const text = (readAnswer(answer, "task").custom ?? "").trim();
	return text || undefined;
}

/**
 * /dev-pre-check：先确认意图，确认后再投递执行提示词。
 * @returns 命令结果文本
 */
export async function runPreCheck(ctx, agent, args, signal, attachments = [], pending) {
	const notices = [];

	try {
		const task = pending?.state.task ?? await readTask(ctx, agent, args, signal);
		pending?.assertCurrent();
		if (!task) return { cancelled: true, notices };
		if (pending) pending.state.task = task;

		const intent = await confirmIntent(task, ctx, agent, signal, notices, attachments, pending);
		checkConfirmation(signal, pending);
		if (intent === undefined) {
			notices.push("已取消，未执行任何改动");
			return { cancelled: true, notices };
		}

		pending?.consume();
		agent.followup(
			createUserMessage({
				content: [{ type: "text", text: buildExecutionPrompt(task, intent) }, ...attachments],
				source: { kind: "user" },
			}),
		);
		notices.push("意图已确认，开始执行");
		return { cancelled: false, notices };
	} catch (error) {
		if (error instanceof NoAnswererError) return { noUi: true, notices };
		if (error instanceof PreCheckAbortedError) return { aborted: true, notices };
		if (error instanceof PreCheckChangedError) return { changed: true, notices };
		throw error;
	}
}
