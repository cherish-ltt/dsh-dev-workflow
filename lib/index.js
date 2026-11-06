/**
 * dsh-dev-workflow：把 pi-dev-workflow 的 /dev-pre-check、/dev-feat、/dev-fix、
 * /dev-refactor、/dev-test 与 dev_ask 工具移植到 DSH。
 */

import { devTypes, runDevCommand } from "./dev-prompts.js";
import { createDevAskTool } from "./dev-ask.js";
import { runPreCheck } from "./pre-check.js";
import { registerAppendSystem } from "./append-system.js";
import { registerBundledSkills } from "./skills.js";

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
	if (outcome.aborted) return { kind: "error", text: "命令在意图确认前被中断（页面刷新、切换会话或再次发送消息都会中断等待）" };
	return { kind: "success", text: outcome.notices.join("\n") };
}

function registerCommand(ctx, definition, run) {
	return ctx.commands.register({
		name: definition.command,
		description: definition.description,
		input: { hint: "任务描述，可附带图片和文件", attachments: true },
		handler: async (invocation) => report(await run(ctx, invocation.agent, invocation.rawInput, invocation.signal, invocation.attachments)),
	});
}

export function apply(ctx, { appendSystem = true } = {}) {
	registerBundledSkills(ctx);
	registerCommand(ctx, PRE_CHECK, runPreCheck);
	for (const type of devTypes()) {
		registerCommand(ctx, type, (inner, agent, args, signal, attachments) =>
			runDevCommand(inner, agent, args, signal, type, attachments),
		);
	}

	ctx.tools.register(createDevAskTool(ctx));
	if (appendSystem) registerAppendSystem(ctx);
}
