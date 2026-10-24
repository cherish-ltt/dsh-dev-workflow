import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { SystemPrompt, renderPrompt } from "@deepseek-ai/dsh-system-prompt";
import { registerAppendSystem } from "../lib/append-system.js";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log("PASS", label);
  else { failures += 1; console.log("FAIL", label, extra); }
}

const EXPECTED = readFileSync(fileURLToPath(new URL("../prompts/APPEND_SYSTEM.md", import.meta.url)), "utf-8");

// 用真实的 SystemPrompt 服务验证拼接语义，而不是只验证注册参数
const root = new Context();
await root.plugin(SystemPrompt, { personaPrefix: "DEPLOYMENT PERSONA" });
root.systemPrompt.variable("model", () => "test-model");
root.systemPrompt.section({ name: "tool:bash", order: 1000, text: "BASH GUIDANCE" });

const before = renderPrompt(await root.systemPrompt.assemble({}));

function row(ctx) {
  registerAppendSystem(ctx);
}
row.inject = ["systemPrompt"];
const fiber = root.plugin(row);
await new Promise((resolve) => setTimeout(resolve, 20));

const after = renderPrompt(await root.systemPrompt.assemble({}));

check("原提示词逐字保留", after.startsWith(before), `${before.length} -> ${after.length}`);
check("追加内容落在末尾", after.endsWith(EXPECTED));
check("长度差恰为分隔符加文件", after.length - before.length === 2 + EXPECTED.length);
check("原有 section 未被替换", after.includes("BASH GUIDANCE") && after.includes("DEPLOYMENT PERSONA"));

// 卸载后不残留
await fiber.dispose();
await new Promise((resolve) => setTimeout(resolve, 20));
check("卸载后 section 被移除", !renderPrompt(await root.systemPrompt.assemble({})).includes("Global Agent Rules"));

// 重新挂载不抛错（HMR 重新加载场景）
const fiber2 = root.plugin(row);
await new Promise((resolve) => setTimeout(resolve, 20));
check("重新挂载不报重复", renderPrompt(await root.systemPrompt.assemble({})).endsWith(EXPECTED));

await fiber2.dispose();
await new Promise((resolve) => setTimeout(resolve, 20));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
