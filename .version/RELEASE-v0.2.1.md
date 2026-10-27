# Release v0.2.1

> 核心变化：修复意图确认阶段命令被宿主中断时被误判为「用户取消」的问题。此前该场景下四个确认选项从未弹出，用户只看到代理的复述正文和一条静默的「已取消」。

## 🐛 Fixes

- 意图确认期间宿主中止命令 `signal`（刷新页面、切换会话、再次发送消息等）时，`tryAsk` 返回的 `undefined` 被当作「用户取消」，`/dev-pre-check` 与四个 dev 命令直接静默结束，四选项确认卡不会出现。现在读取需求、等待复述、确认选择、补充说明四处都区分「signal 已中止」与「用户主动取消」。
- 新增 `PreCheckAbortedError`；`runPreCheck` 与 `runDevCommand` 捕获后返回 `aborted`，命令结果明确报「命令在意图确认前被中断」，不再显示「已取消，未执行任何改动」。
- 用户主动选择「取消」或按 Esc 的行为保持不变，仍显示取消。

## 🧪 Tests

- `commands.test.mjs` 新增中止场景回归测试（3 项）：中止时不发送执行提示词、上报 `aborted`、不误报取消。测试数由 52 项增至 55 项。

## 📝 Docs

- README `## 超时策略` 补充中断与取消的区别说明；测试检查数同步为 55。

## 📦 Files Changed

| 类别 | 文件 |
|---|---|
| 修改 | `lib/pre-check.js`、`lib/dev-prompts.js`、`lib/index.js`、`test/commands.test.mjs`、`README.md` |
| 版本 | `package.json`、`package-lock.json`、`.version/RELEASE-v0.2.1.md` |

## 🔗 Commit History

```
fa61760 fix: 命令被宿主中断时不再静默当作取消
```
