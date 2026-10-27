/**
 * /dev-feat、/dev-fix、/dev-refactor、/dev-test：从 pi-dev-workflow 的
 * extensions/dev-prompts.ts 移植。
 */

import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { NoAnswererError, readAnswer, tryAsk } from "./ask.js";
import { confirmIntent, PreCheckAbortedError } from "./pre-check.js";
import { READ_ONLY_EXPLORATION_RULES } from "./prompts.js";
import { defaultAcceptanceItems, detectProjectDefaults } from "./session-utils.js";

const TASK_ID = "dev-task";

const DEV_TYPES = {
	feat: {
		command: "dev-feat",
		description: "(dev) 新功能实现 — 先复述确认意图，再按 身份职责 + 默认验收标准 组装提示词执行",
		role: (defaults) => `资深 ${defaults.language || "项目"} 工程师`,
		duties: [
			"给出逐步实施计划（要修改/新建的文件、迁移、对现有代码的假设），经我确认后再写代码",
			"只实现任务要求的功能，不顺手重构无关代码",
			"保持现有公共 API 兼容，不为假设性需求添加抽象层",
		],
	},
	fix: {
		command: "dev-fix",
		description: "(dev) 问题修复 — 先复述确认意图，再按 根因定位职责 + 默认验收标准 组装提示词执行",
		role: (defaults) => `资深 ${defaults.language || "项目"} 调试工程师`,
		duties: [
			"先用只读探查定位根因（相关代码、日志、调用链），不用消除报错的方式掩盖症状",
			"修复前说明根因与方案取舍，只改与该问题相关的代码",
			"补一个能复现该问题的测试",
		],
		extraAcceptance: ["新增的复现测试在修复前失败、修复后通过"],
	},
	refactor: {
		command: "dev-refactor",
		description: "(dev) 重构 — 先复述确认意图，再按 行为不变职责 + 默认验收标准 组装提示词执行",
		role: (defaults) => `资深 ${defaults.language || "项目"} 工程师`,
		duties: [
			"重构前后对外行为与公共 API 签名完全一致",
			"先指出要消除的具体结构性问题（带真实文件与位置），再动手；不做与目标无关的调整",
			"不新增功能、不修改业务逻辑",
		],
		extraAcceptance: ["对外行为与公共 API 不变，现有测试全部通过"],
	},
	test: {
		command: "dev-test",
		description: "(dev) 测试补充 — 先复述确认意图，再按 测试职责 + 默认验收标准 组装提示词执行",
		role: () => "资深测试工程师",
		duties: [
			"覆盖成功路径、边界条件与错误分支，测试必须真实执行",
			"断言明确无歧义，不写只验证 mock 的测试",
			"保持与项目既有测试框架和风格一致",
		],
		extraAcceptance: ["新增测试覆盖成功路径、边界条件与错误分支，且全部通过"],
	},
};

function taskSummary(task) {
	return task.split("\n")[0].trim().slice(0, 100);
}

function buildDevPrompt(command, type, task, intent, defaults) {
	return [
		`[${command}] ${taskSummary(task)}`,
		"",
		"## 任务（原始描述）",
		task,
		"",
		"## 已确认的任务意图",
		intent,
		"",
		"## 探索要求（先只读探查，再动手）",
		"动手前必须先看真实代码；实施计划里引用的文件与符号都必须是本轮真实读到的。",
		...READ_ONLY_EXPLORATION_RULES,
		"",
		"## 身份与职责",
		`你是${type.role(defaults)}。`,
		...type.duties.map((duty) => `- ${duty}`),
		"",
		"## 验收标准",
		"以下为默认收尾验收基线；任务描述中另有明确验收标准时，以任务描述为准。",
		...[...defaultAcceptanceItems(defaults), ...(type.extraAcceptance ?? [])].map((item) => `- ${item}`),
	].join("\n");
}

function cwdOf(agent) {
	return agent.session.header.cwd ?? agent.session.meta.cwd ?? process.cwd();
}

async function readTask(ctx, agent, args, signal) {
	const given = args.trim();
	if (given) return given;

	const answer = await tryAsk(
		ctx,
		[
			{
				id: TASK_ID,
				header: "任务描述",
				question: "任务描述（必填，如 实现邮箱密码登录接口）",
			},
		],
		{ agent, signal },
	);
	if (answer === undefined) return undefined;

	const text = (readAnswer(answer, TASK_ID).custom ?? "").trim();
	return text || undefined;
}

/**
 * 执行一个 dev 命令：读任务 → 确认意图 → 投递组装好的提示词。
 * @returns 命令结果
 */
export async function runDevCommand(ctx, agent, args, signal, type) {
	const notices = [];

	try {
		const task = await readTask(ctx, agent, args, signal);
		if (!task) return { cancelled: true, notices };

		const intent = await confirmIntent(task, ctx, agent, signal, notices);
		if (intent === undefined) {
			notices.push("已取消，未执行任何改动");
			return { cancelled: true, notices };
		}

		const defaults = detectProjectDefaults(cwdOf(agent));
		agent.followup(
			createUserMessage({
				content: [{ type: "text", text: buildDevPrompt(type.command, type, task, intent, defaults) }],
				source: { kind: "user" },
			}),
		);
		notices.push(`意图已确认，/${type.command} 提示词已发送给当前代理`);
		return { cancelled: false, notices };
	} catch (error) {
		if (error instanceof NoAnswererError) return { noUi: true, notices };
		if (error instanceof PreCheckAbortedError) return { aborted: true, notices };
		throw error;
	}
}

export function devTypes() {
	return Object.values(DEV_TYPES);
}
