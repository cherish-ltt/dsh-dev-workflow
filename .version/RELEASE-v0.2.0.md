# Release v0.2.0

> 核心变化：放宽意图复述环节的等待上限并加密轮询，减少代理探查代码、生成较长复述时被误判超时中断。

## 🚀 Features

- 意图复述等待策略调整：代理空闲阶段的等待上限由 5 分钟提高到 20 分钟，整个复述环节的绝对上限由 15 分钟提高到 30 分钟；代理忙碌（执行工具、或在 `dev_ask` 上等作答）期间依旧不计时。
- 轮询间隔由 2 秒缩短至 500 毫秒，复述产出后能被更快检测到。
- 上述策略由 `/dev-pre-check` 与 `/dev-feat`、`/dev-fix`、`/dev-refactor`、`/dev-test` 共用，五个命令一并生效。

## 📝 Docs

- README `## 超时策略` 同步新数值，并补充轮询间隔说明。

## 📦 Files Changed

| 类别 | 文件 |
|---|---|
| 修改 | `lib/pre-check.js`、`README.md` |
| 版本 | `package.json`、`package-lock.json`、`.version/RELEASE-v0.2.0.md` |

## 🔗 Commit History

```
709a069 feat: 放宽意图复述等待时间并加密轮询
```
