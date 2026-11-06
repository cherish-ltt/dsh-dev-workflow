import { runPreCheck } from "../lib/pre-check.js";
import { runDevCommand, devTypes } from "../lib/dev-prompts.js";
import { createDevAskTool } from "../lib/dev-ask.js";
import { buildPreCheckPrompt, buildExecutionPrompt } from "../lib/prompts.js";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) console.log("PASS", label);
  else { failures += 1; console.log("FAIL", label, extra); }
}

// ---- 伪 agent：followup 记录提示词，并异步“产出”复述
function makeBus() {
  const listeners = new Set();
  return {
    listeners,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(session, event) { for (const fn of listeners) fn(session, event); },
  };
}

function makeAgent(bus, reply, cwd = "/tmp") {
  const sent = [];
  const session = { header: { cwd }, meta: {} };
  const agent = {
    sent,
    session,
    status: "idle",
    followup(msg) {
      sent.push(msg.content[0].text);
      agent.status = "running";
      bus.emit(session, { type: "turn/start", data: { turn: sent.length } });
      bus.emit(session, { type: "user/message", data: msg });
      setTimeout(() => {
        agent.status = "idle";
        bus.emit(session, {
          type: "assistant/message",
          seq: sent.length,
          time: Date.now() + 1,
          data: { turn: sent.length, step: 1, message: { content: [{ type: "text", text: reply }] } },
        });
        bus.emit(session, { type: "turn/end", data: { turn: sent.length, reason: { kind: "completed" } } });
      }, 0);
    },
  };
  return agent;
}

function makeCtx(answers, skills) {
  const queue = [...answers];
  const bus = makeBus();
  const ctx = {
    asked: [],
    get(key) {
      if (key === "skills") return skills;
      if (key !== "userQuestions") return undefined;
      return {
        ask: async (request) => {
          const next = queue.shift();
          if (next === undefined) throw new Error("unexpected ask: " + JSON.stringify(request.questions[0].question));
          ctx.asked.push(request.questions[0]);
          return next(request);
        },
      };
    },
    on(_evt, fn) { return bus.on(fn); },
  };
  return { ctx, bus };
}

const pick = (id, label) => () => ({ answers: [{ id, selected: [label], custom: "" }] });
const type = (id, text) => () => ({ answers: [{ id, selected: [], custom: text }] });

// ---- 1. pre-check 直接确认
{
  const { ctx, bus } = makeCtx([pick("intent-confirm", "是 — 意图正确，开始执行")]);
  const agent = makeAgent(bus, "复述：要实现登录");
  const out = await runPreCheck(ctx, agent, "实现登录", undefined);
  check("pre-check 接受后发送执行提示词", out.cancelled === false && agent.sent.length === 2);
  check("pre-check 首条为复述提示词", agent.sent[0].startsWith("[pre-check]"));
  check("pre-check 次条为执行提示词", agent.sent[1].startsWith("[execute]") && agent.sent[1].includes("复述：要实现登录"));
  assert.equal(Object.hasOwn(ctx.asked[0], "detail"), false);
  assert.equal(Object.hasOwn(ctx.asked[0], "intent"), false);
  assert.ok(!JSON.stringify(ctx.asked[0]).includes("复述：要实现登录"));
  check("pre-check 确认卡不重复报告，执行保留完整意图", true);
  check("pre-check 通知文案", out.notices.join("|").includes("意图已确认，开始执行"), out.notices.join("|"));
}

// ---- 2. 否 → 修正 → 重新复述 → 接受
{
  const { ctx, bus } = makeCtx([
    pick("intent-confirm", "否 — 意图不正确，我要补充说明后重新分析"),
    type("intent-note", "只改后端，别动前端"),
    pick("intent-confirm", "是 — 意图正确，开始执行"),
  ]);
  const agent = makeAgent(bus, "复述 v2");
  const out = await runPreCheck(ctx, agent, "加缓存", undefined);
  check("修正后重发复述提示词", agent.sent.length === 3 && agent.sent[1].includes("只改后端，别动前端"), String(agent.sent.length));
  check("修正后仍能接受", out.cancelled === false);
}

// ---- 3. 是+补充 → 意图内联补充
{
  const { ctx, bus } = makeCtx([
    pick("intent-confirm", "是 + 补充 — 补充说明后直接开工（不重新复述）"),
    type("intent-note", "顺手加日志"),
  ]);
  const agent = makeAgent(bus, "复述 v1");
  const out = await runPreCheck(ctx, agent, "加接口", undefined);
  check("补充并入意图", agent.sent[1].includes("### 用户补充（已确认，直接采纳，不需重新复述）") && agent.sent[1].includes("顺手加日志"));
  check("补充路径不重发复述", agent.sent.length === 2);
  check("补充路径成功", out.cancelled === false);
}

// ---- 4. 取消
{
  const { ctx, bus } = makeCtx([pick("intent-confirm", "取消")]);
  const agent = makeAgent(bus, "复述");
  const out = await runPreCheck(ctx, agent, "任务", undefined);
  check("取消不发送执行提示词", out.cancelled === true && agent.sent.length === 1);
  check("取消文案", out.notices.join("|").includes("已取消，未执行任何改动"));
}

// ---- 5. dev-feat 组装提示词
{
  const { ctx, bus } = makeCtx([pick("intent-confirm", "是 — 意图正确，开始执行")]);
  const agent = makeAgent(bus, "复述");
  const out = await runDevCommand(ctx, agent, "实现邮箱登录", undefined, devTypes().find((t) => t.command === "dev-feat"));
  const p = agent.sent[1];
  check("dev-feat 标题行", p.startsWith("[dev-feat] 实现邮箱登录"), p.slice(0, 40));
  check("dev-feat 含探索要求", p.includes("## 探索要求（先只读探查，再动手）"));
  check("dev-feat 含职责", p.includes("资深") && p.includes("工程师"));
  check("dev-feat 含验收标准", p.includes("## 验收标准"));
  check("dev-feat 成功通知", out.notices.join("|").includes("/dev-feat 提示词已发送给当前代理"));
}

// ---- 6. dev_ask 结果格式
{
  const tool = createDevAskTool({ get: () => ({ ask: async () => ({ answers: [
    { id: "q1", selected: ["A（推荐）"], custom: "" },
    { id: "q2", selected: [], custom: "我自己写的" },
  ] }) }) });
  const value = await tool.execute({ questions: [
    { header: "方案", question: "选哪个？", options: [{ label: "A（推荐）", description: "d" }, { label: "B", description: "d" }] },
    { header: "细节", question: "怎么处理？", options: [{ label: "X", description: "d" }, { label: "Y", description: "d" }] },
  ] }, { signal: undefined });
  const text = tool.output.render({}, value)[0].text;
  check("dev_ask 作答格式", text.includes("1. 「选哪个？」→ A（推荐）") && text.includes("2. 「怎么处理？」→ 我自己写的"), text);
  check("dev_ask 确认尾注", text.includes("以上答案视为用户已确认的前提"));
  check("dev_ask answers 结构", value.cancelled === false && value.answers[1].answer === "我自己写的");
}

// ---- 7. dev_ask 选项数校验
{
  const tool = createDevAskTool({ get: () => ({ ask: async () => ({ answers: [] }) }) });
  let err;
  try {
    await tool.execute({ questions: [{ header: "h", question: "q?", options: [{ label: "a", description: "d" }] }] }, {});
  } catch (e) { err = e.message; }
  check("dev_ask 拒绝 1 个选项", typeof err === "string" && err.includes("2-4"), String(err));
}

// ---- 8. 无交互界面
{
  const tool = createDevAskTool({ get: () => undefined });
  const value = await tool.execute({ questions: [{ header: "h", question: "q?", options: [{ label: "a", description: "d" }, { label: "b", description: "d" }] }] }, {});
  check("dev_ask 无 UI 返回 cancelled", value.cancelled === true && value.answers[0].answer === null);
}

// ---- 9. 命令被宿主中止：不能静默当成「用户取消」
// 复刻线上事故：代理在 dev_ask 上等待时命令 signal 被中止，作答与复述随后才到达。
// 此时命令必须报 aborted，而不是 cancelled；用户主动取消（signal 未中止）仍走 cancelled。
{
  const { ctx, bus } = makeCtx([]);
  const controller = new AbortController();
  const agent = makeAgent(bus, "复述");
  setTimeout(() => controller.abort(), 0);
  const out = await runPreCheck(ctx, agent, "任务", controller.signal);
  check("中止时不发送执行提示词", agent.sent.length === 1, String(agent.sent.length));
  check("中止上报 aborted", out.aborted === true && out.cancelled === undefined, JSON.stringify(out));
  check("中止不误报取消", !out.notices.join("|").includes("已取消"), out.notices.join("|"));
}

const skillDefinition = (content) => ({
  name: "prompt-check", description: "意图确认", provider: "test", source: "runtime",
  invocation: { modelInvocable: true, userInvocable: true }, content,
});

// 所有命令使用最新技能正文，取消时都不能投递执行任务。
for (const devType of [undefined, ...devTypes()]) {
  const lookups = [];
  const skills = { get: async (...args) => { lookups.push(args); return skillDefinition("唯一技能正文：按用户目标探索"); } };
  const { ctx, bus } = makeCtx([pick("intent-confirm", "取消")], skills);
  const agent = makeAgent(bus, "复述", "/tmp/skill-project");
  const signal = new AbortController().signal;
  const out = devType
    ? await runDevCommand(ctx, agent, "原始任务", signal, devType)
    : await runPreCheck(ctx, agent, "原始任务", signal);
  assert.equal(out.cancelled, true);
  assert.equal(agent.sent.length, 1);
  assert.ok(agent.sent[0].includes("唯一技能正文：按用户目标探索"));
  assert.ok(!agent.sent[0].includes("## 内置 Prompt Check"));
  assert.ok(agent.sent[0].includes("最终确认由命令提供交互卡"));
  assert.deepEqual(lookups, [["prompt-check", { cwd: "/tmp/skill-project", scope: agent, signal }]]);
  assert.ok(!out.notices.join("|").includes("内置"));
  check(`${devType?.command ?? "dev-pre-check"} 使用技能且取消不执行`, true);
}

// 每轮重新加载，不把旧正文缓存成第二套固定指令。
{
  let calls = 0;
  const { ctx, bus } = makeCtx([
    pick("intent-confirm", "否 — 意图不正确，我要补充说明后重新分析"),
    type("intent-note", "只改文档"),
    pick("intent-confirm", "是 — 意图正确，开始执行"),
  ], { get: async () => skillDefinition(`技能正文版本-${++calls}`) });
  const agent = makeAgent(bus, "已核实意图");
  await runPreCheck(ctx, agent, "原始任务", undefined);
  assert.ok(agent.sent[0].includes("技能正文版本-1"));
  assert.ok(agent.sent[1].includes("技能正文版本-2") && !agent.sent[1].includes("技能正文版本-1"));
  assert.ok(agent.sent[1].includes("只改文档"));
  assert.ok(agent.sent[2].includes("原始任务") && agent.sent[2].includes("已核实意图"));
  check("修正后重新读取技能并保留任务与确认意图", true);
}

for (const [label, skills, warning] of [
  ["服务缺失", undefined, "未找到 prompt-check 技能"],
  ["技能缺失", { get: async () => undefined }, "未找到 prompt-check 技能"],
  ["读取失败", { get: async () => { throw new Error("EACCES: denied"); } }, "EACCES: denied"],
  ["正文为空", { get: async () => skillDefinition(" \n") }, "正文为空"],
  ["模型调用禁用", { get: async () => ({ ...skillDefinition("禁止使用的技能正文"), invocation: { modelInvocable: false, userInvocable: true } }) }, "禁止模型调用"],
]) {
  const { ctx, bus } = makeCtx([pick("intent-confirm", "是 — 意图正确，开始执行")], skills);
  const agent = makeAgent(bus, "保底意图");
  const out = await runPreCheck(ctx, agent, "原始任务", undefined);
  assert.equal(out.cancelled, false);
  assert.ok(out.notices.join("|").includes(warning));
  assert.ok(agent.sent[0].includes(warning) && agent.sent[0].includes("报告开头向用户说明"));
  assert.ok(agent.sent[0].includes("## 内置 Prompt Check"));
  assert.ok(agent.sent[0].includes("## 重新复述用户 Prompt") && agent.sent[0].includes("使用对象、目标、范围、约束和验收"));
  assert.ok(!agent.sent[0].includes("禁止使用的技能正文"));
  check(`${label} 明示原因后使用新版保底`, true);
}

{
  const controller = new AbortController();
  const { ctx, bus } = makeCtx([], { get: async () => {
    controller.abort();
    throw new Error("aborted lookup");
  } });
  const agent = makeAgent(bus, "不应产生复述");
  const out = await runPreCheck(ctx, agent, "任务", controller.signal);
  assert.equal(out.aborted, true);
  assert.equal(agent.sent.length, 0);
  assert.ok(!out.notices.join("|").includes("内置"));
  check("技能读取中止不降级、不发送消息", true);
}

for (const devType of devTypes()) {
  const { ctx, bus } = makeCtx([pick("intent-confirm", "是 — 意图正确，开始执行")], {
    get: async () => skillDefinition("新版需求指导"),
  });
  const agent = makeAgent(bus, "确认的验收口径");
  const out = await runDevCommand(ctx, agent, "原始任务", undefined, devType);
  assert.equal(out.cancelled, false);
  assert.equal(agent.sent.length, 2);
  assert.equal(ctx.asked.length, 1);
  assert.equal(Object.hasOwn(ctx.asked[0], "detail"), false);
  assert.equal(Object.hasOwn(ctx.asked[0], "intent"), false);
  assert.ok(!JSON.stringify(ctx.asked[0]).includes("确认的验收口径"));
  assert.ok(agent.sent[1].startsWith(`[${devType.command}]`));
  assert.ok(agent.sent[1].includes("确认的验收口径") && agent.sent[1].includes("原始任务"));
  assert.ok(!agent.sent[1].includes("经我确认后再写代码"));
  check(`${devType.command} 保留类型与验收且不重复确认计划`, true);
}

{
  const cwd = await mkdtemp(join(tmpdir(), "dsh-dev-workflow-cwd-"));
  try {
    await writeFile(join(cwd, "Cargo.toml"), "[package]\nname = 'fixture'\n");
    const lookups = [];
    const { ctx, bus } = makeCtx([pick("intent-confirm", "是 — 意图正确，开始执行")], {
      get: async (_name, options) => { lookups.push(options.cwd); return skillDefinition("当前项目技能"); },
    });
    const originalGet = ctx.get;
    ctx.get = (name) => name === "workingDirectory" ? { get: () => cwd } : originalGet(name);
    const agent = makeAgent(bus, "确认", "/original-project");
    await runDevCommand(ctx, agent, "任务", undefined, devTypes()[0]);
    assert.deepEqual(lookups, [cwd]);
    assert.ok(agent.sent[1].includes("Rust") && agent.sent[1].includes("cargo test"));
    check("切换工作目录后技能与验收探测均使用当前项目", true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const withNote of [false, true]) {
  const controller = new AbortController();
  const abortingAnswer = (id, text) => () => {
    controller.abort();
    return { answers: [{ id, selected: withNote ? [] : [text], custom: withNote ? text : "" }] };
  };
  const { ctx, bus } = makeCtx(withNote ? [
    pick("intent-confirm", "是 + 补充 — 补充说明后直接开工（不重新复述）"),
    abortingAnswer("intent-note", "补充"),
  ] : [abortingAnswer("intent-confirm", "是 — 意图正确，开始执行")]);
  const agent = makeAgent(bus, "复述");
  const out = await runPreCheck(ctx, agent, "任务", controller.signal);
  assert.equal(out.aborted, true);
  assert.equal(agent.sent.length, 1);
  check(`${withNote ? "补充" : "确认"}答案与中止同时返回时不执行`, true);
}

{
  const controller = new AbortController();
  const { ctx, bus } = makeCtx([() => { controller.abort(); return undefined; }]);
  const agent = makeAgent(bus, "不应执行");
  const out = await runDevCommand(ctx, agent, "", controller.signal, devTypes()[0]);
  assert.equal(out.aborted, true);
  assert.equal(agent.sent.length, 0);
  check("输入任务时宿主中止不误报取消", true);
}

{
  const controller = new AbortController();
  const { ctx, bus } = makeCtx([() => { controller.abort(); return undefined; }]);
  const agent = makeAgent(bus, "不应执行");
  agent.followup = (message) => agent.sent.push(message);
  const now = Date.now;
  let time = now();
  Date.now = () => (time += 31 * 60_000);
  try {
    const out = await runPreCheck(ctx, agent, "任务", controller.signal);
    assert.equal(out.aborted, true);
    assert.equal(agent.sent.length, 1);
    check("超时重试问卷中止不误报取消", true);
  } finally {
    Date.now = now;
  }
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
