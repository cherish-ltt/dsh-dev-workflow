import { runPreCheck } from "../lib/pre-check.js";
import { runDevCommand, devTypes } from "../lib/dev-prompts.js";
import { createDevAskTool } from "../lib/dev-ask.js";
import { buildPreCheckPrompt, buildExecutionPrompt } from "../lib/prompts.js";

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
      setTimeout(() => {
        agent.status = "idle";
        bus.emit(session, {
          type: "assistant/message",
          seq: sent.length,
          time: Date.now() + 1,
          data: { turn: 1, step: 1, message: { content: [{ type: "text", text: reply }] } },
        });
      }, 0);
    },
  };
  return agent;
}

function makeCtx(answers) {
  const queue = [...answers];
  const bus = makeBus();
  const ctx = {
    asked: [],
    get(key) {
      if (key !== "userQuestions") return undefined;
      return {
        ask: async (request) => {
          const next = queue.shift();
          if (next === undefined) throw new Error("unexpected ask: " + JSON.stringify(request.questions[0].question));
          ctx.asked.push(request.questions[0].question);
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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
