import { fileURLToPath } from "node:url";
import * as filesystemSkills from "@deepseek-ai/dsh-skill-filesystem";
import { isModelInvocable, renderSkillContent } from "@deepseek-ai/dsh-skill";
import { projectCwd } from "./session-utils.js";

export function registerBundledSkills(ctx) {
	return ctx.plugin(filesystemSkills, {
		providerName: "dev-workflow",
		includeDefaultRoots: false,
		bundledSkillDir: fileURLToPath(new URL("../skills/", import.meta.url)),
	});
}

export async function loadPromptCheck(ctx, agent, signal) {
	signal?.throwIfAborted();
	const cwd = projectCwd(ctx, agent);
	try {
		const skills = ctx.get("skills");
		const skill = await skills?.get("prompt-check", {
			cwd,
			scope: agent,
			signal,
		});
		signal?.throwIfAborted();
		if (!skill) return { warning: "未找到 prompt-check 技能，使用内置需求确认流程。" };
		if (!isModelInvocable(skill)) {
			return { warning: "prompt-check 技能禁止模型调用，使用内置需求确认流程。" };
		}
		if (!skill.content.trim()) return { warning: "prompt-check 技能正文为空，使用内置需求确认流程。" };
		return { instruction: renderSkillContent(skill) };
	} catch (error) {
		signal?.throwIfAborted();
		return { warning: `读取 prompt-check 技能失败：${error.message}；使用内置需求确认流程。` };
	}
}
