/**
 * 把 prompts/APPEND_SYSTEM.md 追加到系统提示词末尾。
 *
 * 注册为独立 section 而非替换：DSH 按 order 升序拼接，原有各 section 逐字保留。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SECTION_NAME = "dev-workflow:append-system";

function readAppendText(ctx) {
	const path = fileURLToPath(new URL("../prompts/APPEND_SYSTEM.md", import.meta.url));
	try {
		return readFileSync(path, "utf-8");
	} catch (error) {
		ctx.logger.warn("dsh-dev-workflow: 读取 %s 失败，跳过追加系统提示词：%o", path, error);
		return undefined;
	}
}

export function registerAppendSystem(ctx) {
	const text = readAppendText(ctx);
	if (text === undefined) return;
	ctx.systemPrompt.section({
		name: SECTION_NAME,
		order: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") + 1,
		text,
		interpolate: false,
	});
}
