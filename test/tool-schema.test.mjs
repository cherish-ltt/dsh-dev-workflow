import { readFileSync } from "node:fs";
import { createDevAskTool } from "../lib/dev-ask.js";
import { validateJsonSchemaValue, assertSupportedJsonSchema } from "@deepseek-ai/dsh-tools";
import { Context } from "@deepseek-ai/cordis";
import { UserQuestionError, UserQuestionService } from "@deepseek-ai/dsh-user-questions";

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

let previewRequest;
const previewTool = createDevAskTool({ get: () => ({ ask: async (request) => {
  previewRequest = request;
  return { answers: [] };
} }) });
await previewTool.execute({ questions: [{ ...questions[0], options: questions[0].options.map((option, index) => ({ ...option, preview: `#### 选项 ${index + 1}\n\n正文` })) }] }, {});
check("预览请求使用行内代码载荷标记", previewRequest.questions[0].detail.startsWith("`dsh-dev-ask-preview-v1`\n\n"));
check("预览边界与普通标题隔离", previewRequest.questions[0].detail.includes("#### `dsh-dev-ask-option-1`\n\n#### 选项 1\n\n正文"));
const previewFixture = JSON.parse(readFileSync(new URL("./fixtures/dsh-preview-0.2.1-rc.5.json", import.meta.url), "utf8"));
await previewTool.execute({ questions: [previewFixture.question] }, {});
check("工具载荷与官方渲染器验收输入一致", previewRequest.questions[0].detail === previewFixture.detail);

const mixedQuestions = [{ ...questions[0], multiSelect: false }, { ...questions[1], multiSelect: true }];
const host = new Context();
try {
  await host.plugin(UserQuestionService);
  let mixedRequest;
  host.on("user-questions/request", async (request) => {
    mixedRequest = request;
    return { answers: [
      { id: "q2", selected: ["Y", "X"], custom: "  两项都要\n保留顺序  " },
      { id: "q1", selected: ["B"], custom: "  单选补充  " },
    ] };
  });
  const mixedTool = createDevAskTool(host);
  assertSupportedJsonSchema(mixedTool.parameters);
  assertSupportedJsonSchema(mixedTool.output.schema);
  const mixed = await mixedTool.execute({ questions: mixedQuestions }, {});
  check("多选标志透传真实宿主服务", mixedRequest.questions[0].multiSelect === false && mixedRequest.questions[1].multiSelect === true);
  check("混合乱序答案保留单选字符串", mixed.answers[0].answer === "单选补充");
  check("多选同时保留完整集合及补充文本", JSON.stringify(mixed.answers[1].answer) === JSON.stringify({ selected: ["Y", "X"], custom: "两项都要\n保留顺序" }), JSON.stringify(mixed));
  check("混合多选输出通过真实 DSH schema", validateJsonSchemaValue(mixedTool.output.schema, mixed, "value").length === 0);
  const mixedText = mixedTool.output.render({}, mixed)[0].text;
  check("多选文本展示全部标签及补充", mixedText.includes("2. 「怎么处理？」→ 已选：Y、X；补充：两项都要\n保留顺序") && !mixedText.includes("[object Object]"), mixedText);

  for (const [label, response, expected] of [
    ["多选仅选择", { answers: [{ id: "q1", selected: ["B", "A（推荐）"] }] }, { selected: ["B", "A（推荐）"] }],
    ["多选仅补充", { answers: [{ id: "q1", selected: [], custom: "另一个方案" }] }, { selected: [], custom: "另一个方案" }],
    ["多选空选择", { answers: [{ id: "q1", selected: [], custom: "  " }] }, null],
    ["多选缺少答案", { answers: [] }, null],
  ]) {
    const scenario = createDevAskTool({ get: () => ({ ask: async () => response }) });
    const result = await scenario.execute({ questions: [{ ...questions[0], multiSelect: true }] }, {});
    check(label, JSON.stringify(result.answers[0].answer) === JSON.stringify(expected) && result.cancelled === false, JSON.stringify(result));
    check(`${label}输出合法`, validateJsonSchemaValue(scenario.output.schema, result, "value").length === 0);
  }

  const skippedMixed = createDevAskTool({ get: () => ({ ask: async () => ({ answers: [{ id: "q2", selected: ["Y", "X"] }] }) }) });
  const skippedMixedValue = await skippedMixed.execute({ questions: mixedQuestions }, {});
  check("混合题缺失答案保持 null", skippedMixedValue.answers[0].answer === null && skippedMixedValue.answers[1].answer.selected.length === 2 && !skippedMixedValue.cancelled);

  for (const code of ["ASK_CANCELLED", "ASK_ABORTED", "NO_PROVIDER"]) {
    const unavailable = createDevAskTool({ get: () => ({ ask: async () => { throw new UserQuestionError("unavailable", code); } }) });
    const result = await unavailable.execute({ questions: mixedQuestions }, {});
    check(`${code}不补出多选答案`, result.cancelled === true && result.answers.every((item) => item.answer === null));
  }
  const noUiMixed = await noUi.execute({ questions: mixedQuestions }, {});
  check("无服务不补出多选答案", noUiMixed.cancelled === true && noUiMixed.answers.every((item) => item.answer === null));

  let invalidModeRejected = false;
  try { await mixedTool.execute({ questions: [{ ...questions[0], multiSelect: "true" }] }, {}); }
  catch { invalidModeRejected = true; }
  check("真实 DSH schema 拒绝非布尔多选标志", invalidModeRejected);
  for (const count of [1, 5]) {
    let invalidCountRejected = false;
    try { await mixedTool.execute({ questions: [{ ...questions[0], multiSelect: true, options: Array.from({ length: count }, (_, index) => ({ label: String(index), description: "d" })) }] }, {}); }
    catch { invalidCountRejected = true; }
    check(`多选仍拒绝 ${count} 个选项`, invalidCountRejected);
  }
} catch (error) {
  check("多选请求可执行", false, String(error));
} finally {
  await host.fiber.dispose();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
