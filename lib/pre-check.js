/**
 * 意图确认：从 pi-dev-workflow 的 extensions/pre-check.ts 移植。
 *
 * 代理先只读探查并复述意图，用户确认后才真正执行。
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { buildExecutionPrompt, buildPreCheckPrompt } from "./prompts.js";
import { extractMessageText, NoAnswererError, readAnswer, tryAsk } from "./ask.js";

const PRE_CHECK_TIMEOUT_MS = 5 * 60_000;
const PRE_CHECK_MAX_WAIT_MS = 15 * 60_000;
const POLL_INTERVAL_MS = 2_000;

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

/** 收集本轮发送之后产生的 assistant 文本，用于判断复述是否已经产出。 */
function trackRestatement(ctx, session, sentAt) {
	let text = "";
	const dispose = ctx.on("session/event", (subject, event) => {
		if (subject !== session || event.type !== "assistant/message") return;
		if (event.time <= sentAt) return;
		const next = extractMessageText(event.data.message.content);
		if (next) text = next;
	});
	return { read: () => text, dispose };
}

/**
 * 等待本轮复述产物：代理忙碌（正在执行工具、或在 dev_ask 上等用户作答）期间不计超时。
 * 同时保留一个绝对上限，避免代理一直不空闲时无限等待。
 */
async function waitForRestatement(ctx, agent, sentAt, signal) {
	const tracker = trackRestatement(ctx, agent.session, sentAt);
	const startedAt = Date.now();
	let deadline = startedAt + PRE_CHECK_TIMEOUT_MS;

	try {
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
async function resolveDecision(ctx, agent, intent, signal) {
	for (;;) {
		const answer = await tryAsk(
			ctx,
			[
				{
					id: CONFIRM_ID,
					header: "意图确认",
					question: "意图确认：以上复述是否准确反映你的目标？",
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
export async function confirmIntent(task, ctx, agent, signal, notices) {
	const corrections = [];

	for (;;) {
		notices.push("正在让代理复述任务意图（只分析，不执行）...");

		const sentAt = Date.now();
		agent.followup(
			createUserMessage({
				content: [{ type: "text", text: buildPreCheckPrompt(task, corrections) }],
				source: { kind: "user" },
			}),
		);

		const intent = await waitForRestatement(ctx, agent, sentAt, signal);
		if (!intent) {
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
			if (retry !== undefined && readAnswer(retry, CONFIRM_ID).label === "重试") continue;
			return undefined;
		}

		const decision = await resolveDecision(ctx, agent, intent, signal);
		if (decision === undefined) return undefined;
		if (decision.intent !== undefined) return decision.intent;
		corrections.push(decision.correction);
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
	if (answer === undefined) return undefined;

	const text = (readAnswer(answer, "task").custom ?? "").trim();
	return text || undefined;
}

/**
 * /dev-pre-check：先确认意图，确认后再投递执行提示词。
 * @returns 命令结果文本
 */
export async function runPreCheck(ctx, agent, args, signal) {
	const notices = [];

	try {
		const task = await readTask(ctx, agent, args, signal);
		if (!task) return { cancelled: true, notices };

		const intent = await confirmIntent(task, ctx, agent, signal, notices);
		if (intent === undefined) {
			notices.push("已取消，未执行任何改动");
			return { cancelled: true, notices };
		}

		agent.followup(
			createUserMessage({
				content: [{ type: "text", text: buildExecutionPrompt(task, intent) }],
				source: { kind: "user" },
			}),
		);
		notices.push("意图已确认，开始执行");
		return { cancelled: false, notices };
	} catch (error) {
		if (error instanceof NoAnswererError) return { noUi: true, notices };
		throw error;
	}
}
