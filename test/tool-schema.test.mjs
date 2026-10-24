import { createDevAskTool } from "../lib/dev-ask.js";
import { validateJsonSchemaValue, assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log("PASS", label);
  else { failures += 1; console.log("FAIL", label, extra); }
}

const questions = [
  { header: "方案", question: "选哪个？", options: [{ label: "A（推荐）", description: "d" }, { label: "B", description: "d" }] },
  { header: "细节", question: "怎么处理？", options: [{ label: "X", description: "d" }, { label: "Y", description: "d" }] },
];

// 乱序作答：验证按 id 映射，而不是按数组位置
const tool = createDevAskTool({
  get: () => ({
    ask: async () => ({
      answers: [
        { id: "q2", selected: [], custom: "自己写的" },
        { id: "q1", selected: ["B"], custom: "" },
      ],
    }),
  }),
});

const value = await tool.execute({ questions }, {});
check("乱序作答按 id 映射", value.answers[0].answer === "B" && value.answers[1].answer === "自己写的", JSON.stringify(value.answers));

// 输出必须通过 DSH 自己的 schema 校验（真实运行时会对结果做这一步）
assertSupportedJsonSchema(tool.output.schema);
const violations = validateJsonSchemaValue(tool.output.schema, value, "value");
check("输出通过 DSH schema 校验", violations.length === 0, JSON.stringify(violations));

// 未作答 + 无 UI 两种情况下 null 也要合法
const noUi = createDevAskTool({ get: () => undefined });
const noUiValue = await noUi.execute({ questions }, {});
check("无 UI 输出合法", validateJsonSchemaValue(noUi.output.schema, noUiValue, "value").length === 0);
check("无 UI 全部 null", noUiValue.answers.every((a) => a.answer === null) && noUiValue.cancelled === true);

const skipped = createDevAskTool({ get: () => ({ ask: async () => ({ answers: [
  { id: "q1", selected: [], custom: "" },
  { id: "q2", selected: ["Y"], custom: "" },
] }) }) });
const skippedValue = await skipped.execute({ questions }, {});
check("跳过题记 null", skippedValue.answers[0].answer === null && skippedValue.answers[1].answer === "Y");
check("跳过输出合法", validateJsonSchemaValue(skipped.output.schema, skippedValue, "value").length === 0);

const text = tool.output.render({}, value)[0].text;
check("渲染跳过题不编号错位", text.includes("1. 「选哪个？」→ B") && text.includes("2. 「怎么处理？」→ 自己写的"), text);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
