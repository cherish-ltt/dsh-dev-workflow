# Release v0.1.1

> 核心变化：首个经 CI 自动发布到 npm 的版本。插件功能（五个 dev 命令、`dev_ask`、追加系统提示词）已完整移植自 pi-dev-workflow；本版补齐发包与发布链路，包名改为 scoped 的 `@ghyper9023/dsh-dev-workflow`，并新增自动测试、自动 Release 与 OIDC 自动发包。

## 🚀 Features

- 移植 pi-dev-workflow 的 dev 工作流：`/dev-pre-check` 意图校验、`/dev-feat`、`/dev-fix`、`/dev-refactor`、`/dev-test` 四个 dev 命令，以及 `dev_ask` 结构化提问工具。提示词文本从 pi 逐字移植，周边代码基于 DSH 原生 API（`ctx.commands.register`、`ctx.tools.register`、`ctx.userQuestions.ask`）重写。
- `dev_ask` 选项支持 `preview` 字段，选中后在同卡右侧展示 Markdown 预览；窄屏（< 720px）自动堆叠为上下布局。
- 加载即把 `prompts/APPEND_SYSTEM.md` 追加到系统提示词末尾：注册在最后一个已分配槽位（`DEPLOYMENT_PERSONA_SUFFIX`）之后，保证原提示词逐字保留、新内容落在末尾，卸载时随插件移除。
- 包名改为 `@ghyper9023/dsh-dev-workflow`（npm 上 `dsh-dev-workflow` 已被他人占用），客户端 bundle id、`cordis.patch.yml` 的 bundle 名同步更新。
- 新增 MIT 与 Apache-2.0 双许可，SPDX 记为 `MIT OR Apache-2.0`。

## 🧪 Tests

- 四套测试共 46 项检查：命令与意图确认流程、工具 schema 与输出校验、客户端渲染逻辑、提示词追加语义（原提示词严格前缀、长度差恰为分隔符加文件长度、卸载可移除、重新挂载不重复注册）。
- 新增版本说明校验（第 5 套）：要求 `package.json` 的版本存在对应 `.version/RELEASE-v<version>.md`，且该文档覆盖上一版本 tag 到文档中最新 commit 区间的全部 commit。

## 🔧 Refactor

- 客户端 bundle id 与样式标记由裸包名改为 scoped 包名，与 DSH 客户端模块的 id 约定一致。

## 🏗️ CI

- 新增 `ci.yml`：push 与 PR 到 `main` 触发，Node 22 与 24 双版本矩阵，`npm ci` → 语法检查 → `npm test`。
- 新增 `publish.yml`：推送 `v*` tag 触发，校验 tag 与 `package.json` 版本一致后跑测试，再以 npm Trusted Publishing（GitHub OIDC）发布，仓库不保存长期 token。
- 新增 `release.yml`：推送 `v*` tag 自动创建 GitHub Release，正文取自 `.version/RELEASE-<tag>.md`。
- checkout 改为 `fetch-depth: 0`：版本说明校验需要读取 tag 与 commit 区间，浅克隆会取不到。

## 📦 Files Changed

| 类别 | 文件 |
|---|---|
| 新增 | `lib/index.js`、`lib/append-system.js`、`lib/pre-check.js`、`lib/dev-prompts.js`、`lib/dev-ask.js`、`lib/ask.js`、`lib/prompts.js`、`lib/session-utils.js`、`lib/client.js`、`prompts/APPEND_SYSTEM.md`、`cordis.patch.yml` |
| 新增 | `test/commands.test.mjs`、`test/tool-schema.test.mjs`、`test/client.test.mjs`、`test/append-system.test.mjs`、`test/version.test.mjs` |
| 新增 | `README.md`、`LICENSE-MIT`、`LICENSE-APACHE`、`package-lock.json`、`.gitignore` |
| 新增 | `.github/workflows/ci.yml`、`.github/workflows/publish.yml`、`.github/workflows/release.yml` |
| 版本 | `package.json`、`package-lock.json`、`.version/RELEASE-v0.1.1.md`、`.version/UNRELEASED.md` |

## 🔗 Commit History

```
c3d1fb6 feat: 移植 pi-dev-workflow 的 dev 工作流命令与 dev_ask 工具
a6ba9b0 feat: dev_ask 选项支持 preview，卡片右侧展示 Markdown 预览
1726b1e feat: 追加 APPEND_SYSTEM.md 到系统提示词末尾
658669d docs: 补充 README 与 MIT/Apache-2.0 双许可
3dbac5f chore: gitignore 忽略 .DS_Store
6710425 chore: 包名改为 @ghyper9023/dsh-dev-workflow 并锁定依赖
d9a5289 ci: main 分支与 PR 自动运行测试
29ef4a4 ci: 推送 v* tag 触发 npm 发布
b63ba94 docs: README 更新包名、安装方式与 CI 发布说明
2756e9a ci: 升级 actions/checkout 与 setup-node 到 v5
c1e69d6 docs: README 靠前补充 dsh 安装命令
b27ca4c ci: checkout 拉取完整 git 历史
a29376a ci: 推送 v* tag 自动创建 GitHub Release
```
