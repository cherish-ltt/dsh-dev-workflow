import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { Context } from "@deepseek-ai/cordis";
import CommandRuntime from "@deepseek-ai/dsh-commands";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import SkillRegistry from "@deepseek-ai/dsh-skill";
import { SystemPrompt, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import * as workflow from "../lib/index.js";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log("PASS", label);
  else { failures += 1; console.log("FAIL", label, extra); }
}

const EXPECTED = readFileSync(fileURLToPath(new URL("../prompts/APPEND_SYSTEM.md", import.meta.url)), "utf-8");

// 用真实的 SystemPrompt 服务验证拼接语义，而不是只验证注册参数
const root = new Context();
await root.plugin(SystemPrompt, { personaPrefix: "DEPLOYMENT PERSONA" });
await root.plugin(CommandRuntime);
await root.plugin(ToolRuntime);
await root.plugin(SkillRegistry);
root.systemPrompt.variable("model", () => "test-model");
root.systemPrompt.section({ name: "tool:bash", order: 1000, text: "BASH GUIDANCE" });

const before = renderPrompt(await root.systemPrompt.assemble({}));

const fiber = await root.plugin(workflow);

const after = renderPrompt(await root.systemPrompt.assemble({}));

check("原提示词逐字保留", after.startsWith(before), `${before.length} -> ${after.length}`);
check("追加内容落在末尾", after.endsWith(EXPECTED));
check("长度差恰为分隔符加文件", after.length - before.length === 2 + EXPECTED.length);
check("原有 section 未被替换", after.includes("BASH GUIDANCE") && after.includes("DEPLOYMENT PERSONA"));

const agent = { session: { header: { cwd: process.cwd() }, meta: {} } };
const commands = root.commands.list(agent);
const skills = await root.skills.list();
fiber.update({ appendSystem: false });
await fiber.await();
check("关闭追加时原提示词完全保留", renderPrompt(await root.systemPrompt.assemble({})) === before);
assert.deepEqual(root.commands.list(agent), commands);
assert.equal(commands.length, 5);
assert.ok(root.tools.get("dev_ask"));
assert.deepEqual(await root.skills.list(), skills);
assert.equal(skills.length, 3);
console.log("PASS 关闭追加不影响五个命令、工具和三个 Skill");

fiber.update({ appendSystem: true });
await fiber.await();
check("重新开启仅追加一次完整原文", renderPrompt(await root.systemPrompt.assemble({})) === after);

for (const appendSystem of ["false", 0, 1, null, [], {}]) {
  assert.throws(() => fiber.update({ appendSystem }), {
    name: "ValidationError", message: /appendSystem 必须是布尔值/u,
  });
}
for (const config of [null, false, "false", []]) {
  assert.throws(() => fiber.update(config), { name: "ValidationError" });
}
check("无效配置不移除已有 section", renderPrompt(await root.systemPrompt.assemble({})) === after);
fiber.update({});
await fiber.await();
check("空配置保持默认开启", renderPrompt(await root.systemPrompt.assemble({})) === after);

// 卸载后不残留
await fiber.dispose();
check("卸载后 section 被移除", !renderPrompt(await root.systemPrompt.assemble({})).includes("Global Agent Rules"));

// 重新挂载不抛错（HMR 重新加载场景）
const fiber2 = await root.plugin(workflow, { appendSystem: false });
check("关闭状态初次挂载不追加", renderPrompt(await root.systemPrompt.assemble({})) === before);
await fiber2.dispose();
const fiber3 = await root.plugin(workflow, { appendSystem: true });
check("重新挂载不报重复", renderPrompt(await root.systemPrompt.assemble({})) === after);

await fiber3.dispose();
await root.fiber.dispose();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
