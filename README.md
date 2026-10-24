# @ghyper9023/dsh-dev-workflow

> 把 [pi-dev-workflow](https://github.com/cherish-ltt/pi-dev-workflow) 的 dev 工作流移植到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：`/dev-pre-check`、`/dev-feat`、`/dev-fix`、`/dev-refactor`、`/dev-test` 与 `dev_ask` 结构化提问工具。

提示词文本从 pi 逐字移植，周边代码基于 DSH 原生 API 重写。

## 安装

```bash
dsh plugin --profile web add @ghyper9023/dsh-dev-workflow
```

装完重启对应客户端生效。把 `web` 换成你的 profile 名即可（内置模板：`web`、`headless`、`acp`、`sdk`）。`desktop` 由 Electron 应用独占管理，需手动编辑 profile，见[安装细节](#安装细节)。

## 包含内容

| 能力 | 形式 | 说明 |
|---|---|---|
| `/dev-pre-check` | 斜杠命令 | 执行前意图校验：先复述意图，确认后才动手 |
| `/dev-feat` | 斜杠命令 | 新功能实现 |
| `/dev-fix` | 斜杠命令 | 问题修复 |
| `/dev-refactor` | 斜杠命令 | 重构 |
| `/dev-test` | 斜杠命令 | 测试补充 |
| `dev_ask` | 工具 | 结构化提问：需求澄清、方案取舍、分轮追问 |
| 追加系统提示词 | 提示词 section | 加载即生效的全局行为规则 |

不在范围内：`/grill`、`/prd`、git 命令、skills、主题。

## 安装细节

`add` 会自动把包写入 profile 的 `dependencies` 与 `dsh.profile.bundles`，无需手工编辑。需要 pnpm 在 PATH 中。

也可手动 link 本地目录，编辑 `~/.dsh/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "@ghyper9023/dsh-dev-workflow": "link:/path/to/dsh-dev-workflow"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@ghyper9023/dsh-dev-workflow"
      ]
    }
  }
}
```

手动编辑 `~/.dsh/profiles/desktop/package.json` 时，`dependencies` 与 `dsh.profile.bundles` 两处都要加上包名；若用 link 挂载，还需在 `node_modules/@ghyper9023/` 下建立指向本仓库的软链接。改完重启客户端生效。

## `/dev-pre-check`

在真正动手前插入一道意图校验闸门：先让 AI 用自己的话复述它理解的任务意图，只有你确认正确后才开始执行。适合需求描述含糊、或希望先对齐理解再让 AI 动代码的场景。

```text
/dev-pre-check 帮我加个邮箱密码登录功能
```

不带参数时弹出输入框补填需求原文。

### 流程

1. **组合提示词** — 用户原始 prompt + 固定的「先只读探查代码库、再重述目标与问题」指令
2. **先探索再复述** — 复述前要求用只读工具确认真实代码（入口文件、现有实现、相关测试、项目约定）；不臆测路径、接口签名与既有行为
3. **只分析不执行** — 禁止修改/创建/删除文件，禁止运行有副作用的命令，禁止输出代码/补丁/实施计划
4. **不确定项当场提问** — 用 `dev_ask` 把「会影响实现方向、又无法从代码或需求推出」的关键不确定项做成「题目 + 2-4 个选项」一次性问完
5. **输出复述** — 按固定格式给出：已核实的现状 / 用户的目标 / 试图解决的问题 / 不确定之处 / 一句话概括
6. **用户确认**

   | 选择 | 行为 |
   |---|---|
   | 是 — 意图正确，开始执行 | 发送「原始 prompt + 已确认的意图复述」开始真正的工作 |
   | 是 + 补充 — 补充说明后直接开工 | 输入补充说明 → 并入已确认意图 → 直接开工，不再复述 |
   | 否 — 意图不正确 | 输入修正说明 → 重新复述 → 再次确认（可循环） |
   | 取消 / Esc | 结束，不产生任何改动 |

7. **开始工作** — 已确认的意图复述作为权威前提一并发给代理

### 超时策略

信号为「代理空闲且本轮产生了新的 assistant 文本」，空闲阶段等待上限 5 分钟；代理忙碌（执行工具、或在 `dev_ask` 上等作答）时不计超时，整个复述环节最多等 15 分钟。超时后弹出「重试 / 取消」供你决定。

## Dev 命令

四个命令对应四类高频任务。命令参数就是任务原文，不带参数时才弹一次输入框；项目语言、测试命令、lint 命令由项目探测自动补齐。

| 命令 | 用途 | 提示词中的身份 |
|---|---|---|
| `/dev-feat` | 新功能实现 | 资深 <项目语言> 工程师 |
| `/dev-fix` | 问题修复 | 资深 <项目语言> 调试工程师 |
| `/dev-refactor` | 重构 | 资深 <项目语言> 工程师 |
| `/dev-test` | 测试补充 | 资深测试工程师 |

### 提示词结构

组装出的提示词只补三件事：先只读探查代码库的要求、AI 的身份与职责、未说明验收标准时的默认收尾验收标准。

```markdown
[dev-feat] 实现邮箱密码登录接口

## 任务（原始描述）
实现邮箱密码登录接口

## 已确认的任务意图
（你确认过的复述原文）

## 探索要求（先只读探查，再动手）
动手前必须先看真实代码；实施计划里引用的文件与符号都必须是本轮真实读到的。
- 用只读工具确认：入口文件、现有实现、相关测试、项目约定与配置
- 不臆测文件路径、接口签名、依赖与既有行为
- 相关概念在代码库中确实不存在时，明确写出「未发现」并交代检索范围

## 身份与职责
你是资深 TypeScript 工程师。
- 给出逐步实施计划，经我确认后再写代码
- 只实现任务要求的功能，不顺手重构无关代码
- 保持现有公共 API 兼容，不为假设性需求添加抽象层

## 验收标准
以下为默认收尾验收基线；任务描述中另有明确验收标准时，以任务描述为准。
- 运行 pnpm test 确认全部测试通过、无回归
- 运行 pnpm lint 符合代码规范
```

各命令的职责差异：

| 命令 | 额外职责 | 额外验收项 |
|---|---|---|
| `/dev-feat` | 实施计划先确认、不做无关重构、保持 API 兼容 | — |
| `/dev-fix` | 只读探查定位根因、不掩盖症状、补复现测试 | 复现测试修复前失败、修复后通过 |
| `/dev-refactor` | 行为与 API 签名不变、先指出具体结构性问题 | 对外行为与 API 不变 |
| `/dev-test` | 覆盖成功/边界/错误分支、断言明确 | 三类分支全覆盖且通过 |

## `dev_ask` 结构化提问

`dev_ask` 加载后默认供模型直接调用，适用于普通对话中的需求澄清、方案取舍、用户偏好和分轮追问，不依赖 `/dev-pre-check`。它是工具而非斜杠命令，保持 model-only，不能通过其他工具间接调用。

- 每题 2-4 个互斥选项，每个都有 label 与 description；推荐项放第一位并在 label 末尾加「（推荐）」
- 自动提供自由输入与 Esc 放弃
- 每轮一次问完前置条件已明确的问题，收到答案后再问依赖这些答案的下一轮
- 没有交互界面时不弹问卷，模型应把待决问题写入文字说明
- 未作答不代表同意推荐项，作答也不等于授权执行未被要求的操作

### 选项预览

选项可带 `preview` 字段（Markdown），卡片右侧面板展示当前高亮项的预览，宽屏左右分栏、窄屏上下排列。

- 支持标题、列表、表格、行内代码与代码块
- ASCII 结构图、代码、配置请放进代码块以保留缩进与对齐
- 切换选项时预览同步切换；某项无 preview 时右栏收起

实现上，`preview` 被合并进问题级 `detail` 字段（DSH 服务端 schema 不接受选项级 preview），由客户端插件解析渲染成右侧面板。

## 追加系统提示词

`prompts/APPEND_SYSTEM.md` 在插件加载时注册为一个独立的 prompt section，追加到系统提示词末尾，原有提示词逐字保留。

包含的规则：中文回复、思考过程（审题→思考→汇总→验证→讨教→最终）、工作过程（阅读→编写→审查→自审→检验→验证→最终）、编码规范、调试策略、执行规则、验证要求、最终总结格式。

实现要点：

- 注册在 `DEPLOYMENT_PERSONA_SUFFIX` 之后一位，即提示词最末尾
- `interpolate: false`，文件里的 `{{...}}` 不会被当成提示词变量解析
- 不设 `complete`，因此不会替换整段系统提示词
- 注册归属插件上下文，卸载时自动清理，HMR 重载不报重复

> 若使用内置 `minimal` agent preset（其 persona 设了 `complete: true`），整段系统提示词被替换，追加内容不会出现。默认的 `standard` preset 不受影响。

## 目录结构

```
dsh-dev-workflow/
├── package.json                 # 包元数据与 DSH 配置
├── package-lock.json            # CI 与发布使用 npm ci
├── cordis.patch.yml             # bundle 插入声明
├── .github/workflows/
│   ├── ci.yml                   # push/PR 到 main 触发测试
│   └── publish.yml              # 推送 v* tag 触发 npm 发布
├── prompts/
│   └── APPEND_SYSTEM.md         # 追加到系统提示词末尾的全局规则
├── lib/
│   ├── index.js                 # 插件入口：注册命令、工具、提示词 section
│   ├── append-system.js         # 追加系统提示词
│   ├── pre-check.js             # /dev-pre-check 意图校验
│   ├── dev-prompts.js           # 四个 dev 命令
│   ├── dev-ask.js               # dev_ask 工具定义与校验
│   ├── ask.js                   # 提问封装：映射到 DSH userQuestions
│   ├── prompts.js               # 提示词模板
│   ├── session-utils.js         # 项目探测、验收标准、轮询等待
│   └── client.js                # 客户端半：选项预览右侧面板
└── test/
    ├── commands.test.mjs        # 命令与意图确认流程
    ├── tool-schema.test.mjs     # 工具 schema 与输出校验
    ├── client.test.mjs          # 客户端渲染逻辑
    └── append-system.test.mjs   # 提示词追加语义
```

## 与 pi 版本的差异

| 方面 | pi-dev-workflow | 本插件 |
|---|---|---|
| 命令注册 | `pi.registerCommand` | `ctx.commands.register` |
| 提问 | `uiSelect` / `uiInput` | `ctx.userQuestions.ask`（同卡多题） |
| 提示词注入 | `before_agent_start` 钩子拼接 | `ctx.systemPrompt.section` 独立 section |
| 工具定义 | 扩展内声明 | `defineTool` + JSON Schema 校验 |
| 选项预览 | TUI 高亮详情 | 客户端插件渲染 Markdown 右侧面板 |
| 界面 | 终端 TUI | Web 图形界面 |

提示词文本（意图复述指令、只读探查规则、身份职责、验收标准、`APPEND_SYSTEM.md`）与 pi 版本逐字一致。

## 开发

```bash
npm ci
npm test        # 四套测试
node --check lib/index.js
```

测试覆盖命令流程、工具 schema、客户端渲染与提示词追加语义，共 46 项检查。

## CI 与发布

| 工作流 | 触发 | 行为 |
|---|---|---|
| `ci.yml` | push / PR 到 `main` | Node 22 与 24 双版本：`npm ci` → 语法检查 → `npm test` |
| `publish.yml` | 推送 `v*` tag | 校验 tag 与 `package.json` 版本一致 → 测试 → `npm publish` |

发布使用 npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（GitHub OIDC），仓库中不保存长期 token。

### 发布步骤

```bash
npm version patch          # 或 minor / major，自动打 tag
git push --follow-tags
```

`publish.yml` 要求：npm 包已存在且已配置 Trusted Publisher（GitHub 仓库 `cherish-ltt/dsh-dev-workflow`、工作流文件 `publish.yml`、环境 `npm`）；`repository.url` 与仓库地址一致；Runner 为 GitHub 托管；Node >= 22.14.0、npm >= 11.5.1。

## License

双协议并行，任选其一：

- [MIT](./LICENSE-MIT)
- [Apache-2.0](./LICENSE-APACHE)

SPDX 标识：`MIT OR Apache-2.0`
