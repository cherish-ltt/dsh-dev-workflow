/**
 * 提问封装：把 pi 的 uiSelect / uiInput 映射到 DSH 的 ctx.userQuestions。
 *
 * pi 的 uiSelect 是一个选项列表，uiInput 是一个自由文本输入框；DSH 的
 * 提问卡片把两者合在同一张卡上：有 options 时渲染选项列表并附带自由输入，
 * 没有 options 时只渲染自由输入。
 */

import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";

/** 当前会话没有可用的回答者（无交互界面）。 */
export class NoAnswererError extends Error {
	constructor() {
		super("当前会话没有交互式界面，无法向用户提问");
		this.name = "NoAnswererError";
	}
}

function serviceOf(ctx) {
	const service = ctx.get("userQuestions");
	if (service === undefined) throw new NoAnswererError();
	return service;
}

/**
 * 提一批问题并等待答案。
 * @param {object} ctx 插件上下文
 * @param {Array<object>} questions DSH 提问条目（id/question/header/options）
 * @param {{ agent?: object, signal?: AbortSignal }} scope 目标代理与中止信号
 * @returns 答案；用户取消或信号中止时返回 undefined
 */
export async function tryAsk(ctx, questions, scope = {}) {
	const request = { questions };
	if (scope.agent !== undefined) request.agent = scope.agent;
	if (scope.signal !== undefined) request.signal = scope.signal;

	try {
		return await serviceOf(ctx).ask(request);
	} catch (error) {
		if (!(error instanceof UserQuestionError)) throw error;
		if (error.code === "ASK_CANCELLED" || error.code === "ASK_ABORTED") return undefined;
		if (error.code === "NO_PROVIDER") throw new NoAnswererError();
		throw error;
	}
}

/**
 * 读取单题的作答结果。
 * @returns {{ label?: string, custom?: string }} 选项标签或自由文本；两者皆无表示跳过
 */
export function readAnswer(answer, id) {
	const item = answer?.answers.find((entry) => entry.id === id);
	if (item === undefined) return {};

	const custom = typeof item.custom === "string" ? item.custom.trim() : "";
	if (custom !== "") return { custom };

	const label = item.selected[0];
	if (label !== undefined) return { label };
	return {};
}

/** 从 assistant 消息内容里取出纯文本。 */
export function extractMessageText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	const parts = [];
	for (const block of content) {
		if (typeof block === "string") parts.push(block);
		else if (block && block.type === "text" && typeof block.text === "string") parts.push(block.text);
	}
	return parts.join("\n");
}
