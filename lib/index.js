/**
 * dsh-dev-workflow：把 pi-dev-workflow 的 /dev-pre-check、/dev-feat、/dev-fix、
 * /dev-refactor、/dev-test 与 dev_ask 工具移植到 DSH。
 */

import { devTypes, runDevCommand } from "./dev-prompts.js";
import { createDevAskTool } from "./dev-ask.js";
import { runPreCheck } from "./pre-check.js";
import { registerAppendSystem } from "./append-system.js";
import { registerBundledSkills } from "./skills.js";
import { createPendingIntents } from "./pending-intent.js";

export const name = "dev-workflow";

export const inject = ["commands", "tools", "systemPrompt"];

export const Config = {
	"~standard": {
		version: 1,
		vendor: "dev-workflow",
		validate(config = {}) {
			if (config === null || typeof config !== "object" || Array.isArray(config)) {
				return { issues: [{ message: "插件配置必须是对象" }] };
			}
			if (config.appendSystem !== undefined && typeof config.appendSystem !== "boolean") {
				return { issues: [{ message: "appendSystem 必须是布尔值", path: ["appendSystem"] }] };
			}
			return { value: config };
		},
	},
};

const PRE_CHECK = {
	command: "dev-pre-check",
	description: "(pre-check) 先让 AI 复述任务意图并确认，确认正确后再开始真正的工作",
};

function report(outcome) {
	if (outcome.noUi) return { kind: "error", text: "当前会话没有交互式界面，无法确认意图" };
	if (outcome.aborted) return { kind: "error", text: "命令在意图确认前被中断；完整报告已生成时，可在原会话运行 /dev-resume 重新确认，否则请重新发起原命令。" };
	if (outcome.changed) return { kind: "error", text: "工作目录或会话输入已变化，请运行 /dev-resume 重新分析后再确认。" };
	return { kind: "success", text: outcome.notices.join("\n") };
}

async function runPending(ctx, agent, pending) {
	const { state, signal } = pending;
	let outcome;
	try {
		outcome = state.command === PRE_CHECK.command
			? await runPreCheck(ctx, agent, "", signal, state.attachments, pending)
			: await runDevCommand(ctx, agent, "", signal, devTypes().find((type) => type.command === state.command), state.attachments, pending);
		return report(outcome);
	} finally {
		pending.finish(outcome);
	}
}

function registerCommand(ctx, definition, records) {
	return ctx.commands.register({
		name: definition.command,
		description: definition.description,
		input: { hint: "任务描述，可附带图片和文件", attachments: true },
		handler(invocation) {
			const pending = records.begin(invocation.agent, definition.command, invocation.attachments, invocation.signal);
			pending.state.task = invocation.rawInput.trim() || undefined;
			return runPending(ctx, invocation.agent, pending);
		},
	});
}

export function apply(ctx, { appendSystem = true } = {}) {
	const records = createPendingIntents(ctx);
	registerBundledSkills(ctx);
	registerCommand(ctx, PRE_CHECK, records);
	for (const type of devTypes()) {
		registerCommand(ctx, type, records);
	}
	ctx.commands.register({
		name: "dev-resume",
		description: "恢复当前会话最近一次完整待确认报告，重新确认后执行",
		handler(invocation) {
			if (invocation.rawInput.trim()) return { kind: "error", text: "/dev-resume 不接受新任务文字；请用原 dev 命令提交新的需求。" };
			const pending = records.resume(invocation.agent, invocation.signal);
			if (pending.error) return { kind: "error", text: pending.error };
			return runPending(ctx, invocation.agent, pending);
		},
	});

	ctx.tools.register(createDevAskTool(ctx));
	if (appendSystem) registerAppendSystem(ctx);
}
