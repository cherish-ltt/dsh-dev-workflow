/**
 * dsh-dev-workflow：把 pi-dev-workflow 的 /dev-pre-check、/dev-feat、/dev-fix、
 * /dev-refactor、/dev-test 与 dev_ask 工具移植到 DSH。
 */

import { devTypes, runDevCommand } from "./dev-prompts.js";
import { createDevAskTool } from "./dev-ask.js";
import { runPreCheck } from "./pre-check.js";
import { registerAppendSystem } from "./append-system.js";

export const name = "dev-workflow";

export const inject = ["commands", "tools", "systemPrompt"];

const PRE_CHECK = {
	command: "dev-pre-check",
	description: "(pre-check) 先让 AI 复述任务意图并确认，确认正确后再开始真正的工作",
};

function report(outcome) {
	if (outcome.noUi) return { kind: "error", text: "当前会话没有交互式界面，无法确认意图" };
	return { kind: "success", text: outcome.notices.join("\n") };
}

function registerCommand(ctx, definition, run) {
	return ctx.commands.register({
		name: definition.command,
		description: definition.description,
		handler: async (invocation) => report(await run(ctx, invocation.agent, invocation.rawInput, invocation.signal)),
	});
}

export function apply(ctx) {
	registerCommand(ctx, PRE_CHECK, runPreCheck);
	for (const type of devTypes()) {
		registerCommand(ctx, type, (inner, agent, args, signal) =>
			runDevCommand(inner, agent, args, signal, type),
		);
	}

	ctx.tools.register(createDevAskTool(ctx));
	registerAppendSystem(ctx);
}
