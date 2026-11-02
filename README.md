# @ghyper9023/dsh-dev-workflow

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 dev 工作流插件：五个 `dev-*` 命令、`dev_ask` 结构化提问工具、三个原生 Skill 与追加全局规则。

## 核心理念

先通过 `prompt-check` 理解需求，再由用户确认后执行；以实际证据和验证结果交付。

- **技能优先**：需求理解由可编辑的 `prompt-check` 指导，不再以硬编码文本作为主要来源；技能不可用时明确提示并使用新版内置流程。
- **确认后执行**：只读探索、关键澄清、需求报告、确认卡、正式工作；已确认的常规操作和实施计划不重复确认。
- **如实交付**：全局规则要求报告结果、自我 Review 和可观察的前后对比，不把计划或预期当作实测。

这些是提示词约束和命令流程控制，不是文件系统沙箱，也不能保证模型始终遵守所有指令。

## 安装

```bash
dsh plugin --profile web add @ghyper9023/dsh-dev-workflow@0.3.0
```

装完按宿主提示启用或重启对应客户端。把 `web` 换成你的 profile 名即可（内置模板包括 `web`、`headless`、`acp`、`sdk`、`sdk-minimal`）；`dev-*` 的确认卡需要交互界面。`desktop` 由 Electron 管理，npm CLI 不接受其插件管理请求，见[安装细节](#安装细节)。

### 兼容范围

| 插件版本 | DSH 基准 | 兼容说明 |
|---|---|---|
| `0.3.0` | `0.2.1-rc.5` | 本版精确声明支持开发时 npm `latest` 对应版本，不是 `alpha`；其他版本不在本版声明范围。 |
| `0.1.1`–`0.2.1` | `0.2.1-rc.2` | 历史版本的依赖声明基准，本轮未重新测试这些历史组合。 |

DSH 会检查插件声明的兼容范围；不要用 `alpha` 或强制忽略兼容检查代替受支持版本。`latest` 标签会变化，升级其他 DSH 版本前应重新验证。

## 包含内容

| 能力 | 形式 | 说明 |
|---|---|---|
| `/dev-pre-check` | 斜杠命令 | 执行前意图校验：先复述意图，确认后才动手 |
| `/dev-feat` | 斜杠命令 | 新功能实现 |
| `/dev-fix` | 斜杠命令 | 问题修复 |
| `/dev-refactor` | 斜杠命令 | 重构 |
| `/dev-test` | 斜杠命令 | 测试补充 |
| `dev_ask` | 工具 | 结构化提问：需求澄清、方案取舍、分轮追问 |
| `prompt-check` | Skill | 先探索真实项目，再复述需求并等待确认 |
| `project-audit-review` | Skill | 验证项目问题并交付 Issue，不修复正式代码 |
| `issue-to-pr` | Skill | 检查协作状态、认领 Issue、修复验证并交付 PR |
| 追加系统提示词 | 提示词 section | 加载即生效的新版八节全局行为规则 |

## 安装细节

`add` 会自动把包写入 profile 的 `dependencies` 与 `dsh.profile.bundles`，无需手工编辑。`dsh plugin --profile <name>` 将余下参数原样交给 pnpm，因此支持上面的 `包名@版本` 写法；npm CLI 需要 pnpm 在 PATH 中。

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

Desktop 可使用其插件界面或内置命令管理已初始化的 profile。若手动编辑 `~/.dsh/profiles/desktop/package.json`，先完全退出应用，`dependencies` 与 `dsh.profile.bundles` 两处都要加上包名；若用 link 挂载，还需确保 `node_modules/@ghyper9023/` 下存在指向本仓库的软链接。改完重启客户端生效。

## Skill 注册与维护

三个技能放在 `skills/<name>/SKILL.md`，随 npm 安装包一起分发。插件通过 DSH 官方 `dsh-skill-filesystem` provider 注册到原生 `skills` 服务，不复制到用户目录，也不使用私有技能注册表。宿主提供技能目录和加载工具时，可按普通 DSH Skill 发现、读取它们；注册本身不会自动执行审查、创建 Issue 或发布 PR。

插件的 `dev-workflow` provider 只扫描包内 `skills/`，以原生 `bundled` 优先级参与合并，不重复扫描项目或用户目录。宿主启用默认文件系统 provider 时，同名技能沿用 DSH 原生优先级：

| 优先级（高到低） | 来源 |
|---|---|
| 1 | 项目 `.dsh/skills/` |
| 2 | 项目 `.agents/skills/` |
| 3 | 运行时注册的技能 |
| 4 | 宿主配置的自定义技能目录 |
| 5 | 用户 `$DSH_HOME/skills/`（默认 `~/.dsh/skills/`） |
| 6 | 用户 `$DSH_AGENTS_HOME/skills/`（默认 `~/.agents/skills/`） |
| 7 | 插件随包提供的 `skills/` |

该顺序适用于同一作用域层；当前代理更近的作用域层优先于全局层。命令读取时传入当前代理及项目目录，遵循相同规则。

例如在项目 `.agents/skills/prompt-check/SKILL.md` 保存同名技能，即可在该项目覆盖随包版本。优先级更高的同名技能不会与随包正文拼接；检查实际加载来源，避免误以为修改了未被选中的文件也会生效。

每轮需求复述前都通过原生服务读取当前 `prompt-check` 正文，包括用户修正后重新分析、超时重试。只修改已发现技能的正文时，**下次读取就会生效，无需修改 JavaScript 或重启插件**；已发送的历史消息不会被追溯替换。新增、重命名或修改 frontmatter 由宿主目录监听更新发现结果。修改已安装 npm 包可能被升级覆盖，长期定制宜使用项目或用户技能目录。

当 `prompt-check` 未找到、读取失败、正文为空或禁止模型调用时，命令提示具体原因，并使用以新版技能为模板的内置需求确认流程。例如：`未找到 prompt-check 技能，使用内置需求确认流程。` 读取被宿主中止不属于正常降级，不应继续发送执行提示词。

原生服务读取时保留完整正文；通过模型的 `skill` 工具加载长技能后，仍可能受到宿主上下文压缩策略的工具结果裁剪，尤其是长安装路径下的 `issue-to-pr`。本插件不修改宿主压缩策略；显式 `/issue-to-pr` 调用使用原生指令注入，不走工具结果裁剪路径。

## `/dev-pre-check`

在真正动手前插入一道意图校验闸门：先让 AI 用自己的话复述它理解的任务意图，只有你确认正确后才开始执行。适合需求描述含糊、或希望先对齐理解再让 AI 动代码的场景。

```text
/dev-pre-check 帮我加个邮箱密码登录功能
```

不带参数时弹出输入框补填需求原文。

### 流程

1. **读取指导** — 原生服务读取当前 `prompt-check`，组合用户原始 prompt；不可用时提示原因并使用新版内置流程
2. **先探索再复述** — 复述前要求用只读工具确认真实代码（入口文件、现有实现、相关测试、项目约定）；不臆测路径、接口签名与既有行为
3. **只分析不执行** — 禁止文件写入、依赖安装、构建、测试、Git 写操作及写入类工具，不输出代码/补丁/具体实施方案
4. **不确定项当场提问** — 用 `dev_ask` 把「会影响实现方向、又无法从代码或需求推出」的关键不确定项做成「题目 + 2-4 个选项」一次性问完
5. **输出需求报告** — 随包技能及内置流程均使用：已核实的项目现状 / 重新复述用户 Prompt / 试图解决的问题与用户目标 / 不确定之处 / 一句话概括
6. **用户确认** — 代理报告完成后停止，由命令提供确认卡；不让技能自行再弹一遍最终确认

   | 选择 | 行为 |
   |---|---|
   | 是 — 意图正确，开始执行 | 发送「原始 prompt + 已确认的意图复述」开始真正的工作 |
   | 是 + 补充 — 补充说明后直接开工 | 输入补充说明 → 并入已确认意图 → 直接开工，不再复述 |
   | 否 — 意图不正确 | 输入修正说明 → 重新复述 → 再次确认（可循环） |
   | 在确认卡选择取消 / Esc | 结束，命令不发送执行提示词 |

7. **开始工作** — 原始任务与已确认意图一并发给代理，按原任务类型和授权范围自主执行，不重复要求确认实施计划；只有新的重大不确定项、破坏性操作、未授权外部写入或范围变化需要再问

确认卡中直接输入文字沿用原有行为：作为已确认的补充说明，直接开工；若需要重新分析，请选择「否」。补充/修正输入框中按 Esc 会返回确认卡。没有交互界面时返回无法确认意图的错误，不自动视为用户同意。

### 超时策略

信号为「代理空闲且本轮产生了新的 assistant 文本」，每 500 毫秒轮询一次；代理空闲时等待上限 20 分钟；代理忙碌（执行工具、或在 `dev_ask` 上等作答）时不计超时，整个复述环节最多等 30 分钟。超时后弹出「重试 / 取消」供你决定。

命令等待期间若被宿主中断（例如刷新页面、切换会话、再次发送消息），命令会明确报「意图确认前被中断」，不会误报为「已取消」；只有你主动选择取消才会显示取消。

## Dev 命令

四个命令对应四类高频任务，都复用与 `/dev-pre-check` 相同的 Skill 优先、提示降级及确认流程。命令参数就是任务原文，不带参数时才弹一次输入框；项目语言、测试命令、lint 命令由项目探测自动补齐。

| 命令 | 用途 | 提示词中的身份 |
|---|---|---|
| `/dev-feat` | 新功能实现 | 资深 <项目语言> 工程师 |
| `/dev-fix` | 问题修复 | 资深 <项目语言> 调试工程师 |
| `/dev-refactor` | 重构 | 资深 <项目语言> 工程师 |
| `/dev-test` | 测试补充 | 资深测试工程师 |

### 提示词结构

确认后保留原任务与已确认意图，再补充必要的真实代码探索要求、任务身份与职责、未说明验收标准时的默认收尾基线。需求理解的主要内容维护在 `prompt-check`，代码只保留命令交互边界、任务类型差异和不可用时的保底文本。

```markdown
[dev-feat] 实现邮箱密码登录接口

## 任务（原始描述）
实现邮箱密码登录接口

## 已确认的任务意图
（你确认过的复述原文）
意图已确认，沿用需求理解阶段的指导，按本命令的任务类型执行，不重复启动确认流程。

## 探索要求（先只读探查，再动手）
动手前必须先看真实代码；实施计划里引用的文件与符号都必须是本轮真实读到的。
- 用 read / grep / glob 等只读工具确认：入口文件、现有实现、相关测试、项目约定与配置。
- 不臆测文件路径、接口签名、依赖与既有行为。
- 相关概念在代码库中确实不存在时，明确写出「未发现」并交代检索范围（搜了什么、覆盖哪些目录）。
- 探查到足以支撑产出为止，不做与任务无关的全库通读。

## 身份与职责
你是资深 TypeScript 工程师。
- 在已确认的需求和授权范围内自主实施，不重复要求确认实施计划；新的重大不确定项或超出范围时再询问
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
| `/dev-feat` | 已确认范围内自主实施、不做无关重构、保持 API 兼容 | — |
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

使用新版八节规则：基本原则、思考流程、执行流程、编码规范、Debug 规范、Git 规范、最终报告、最高优先级。最终报告要求结果、自我 Review 和可观察的前后对比；未验证的预期必须标明。全文见 [`prompts/APPEND_SYSTEM.md`](prompts/APPEND_SYSTEM.md)，不包含本机路径或额外配置引用。

实现要点：

- 注册在 `DEPLOYMENT_PERSONA_SUFFIX` 之后一位，即提示词最末尾
- `interpolate: false`，文件里的 `{{...}}` 不会被当成提示词变量解析
- 不设 `complete`，因此不会替换整段系统提示词
- 注册归属插件上下文，卸载时自动清理，HMR 重载不报重复
- 全局规则在插件加载时读取；修改该文件需要重新加载插件，与 Skill 正文的按次读取不同

> 若使用内置 `minimal` agent preset（其 persona 设了 `complete: true`），整段系统提示词被替换，追加内容不会出现。默认的 `standard` preset 不受影响。

## 目录结构

```
dsh-dev-workflow/
├── package.json                 # 包元数据与 DSH 配置
├── package-lock.json            # CI 与发布使用 npm ci
├── cordis.patch.yml             # bundle 插入声明
├── .github/workflows/
│   ├── ci.yml                   # push/PR 到 main 触发测试
│   ├── publish.yml              # 推送 v* tag 触发 npm 发布
│   └── release.yml              # 推送 v* tag 创建 GitHub Release
├── .version/
│   ├── UNRELEASED.md            # 未发布变更
│   └── RELEASE-v0.3.0.md         # 版本日志，同时作为 Release 正文
├── prompts/
│   └── APPEND_SYSTEM.md         # 追加到系统提示词末尾的全局规则
├── skills/
│   ├── prompt-check/SKILL.md     # 需求理解与确认的主要指导
│   ├── project-audit-review/SKILL.md
│   └── issue-to-pr/SKILL.md
├── lib/
│   ├── index.js                 # 插件入口：注册命令、工具、技能、提示词 section
│   ├── append-system.js         # 追加系统提示词
│   ├── skills.js                # 原生 Skill 注册与 prompt-check 读取
│   ├── pre-check.js             # /dev-pre-check 意图校验
│   ├── dev-prompts.js           # 四个 dev 命令
│   ├── dev-ask.js               # dev_ask 工具定义与校验
│   ├── ask.js                   # 提问封装：映射到 DSH userQuestions
│   ├── prompts.js               # 确认边界、执行提示词与内置保底文本
│   ├── session-utils.js         # 项目探测与默认验收标准
│   └── client.js                # 客户端半：选项预览右侧面板
└── test/
    ├── commands.test.mjs        # 命令与意图确认流程
    ├── skills.test.mjs          # 原生注册、优先级、正文重读与不可用处理
    ├── tool-schema.test.mjs     # 工具 schema 与输出校验
    ├── client.test.mjs          # 客户端渲染逻辑
    ├── append-system.test.mjs    # 提示词追加语义
    └── version.test.mjs         # 版本日志完整性与 commit 覆盖
```

## 开发

```bash
npm ci
npm test
for f in lib/*.js test/*.mjs; do node --check "$f"; done
npm pack --dry-run
```

测试覆盖命令流程、Skill 注册与读取、工具 schema、客户端渲染、提示词追加语义及版本日志完整性。打包预览应包含三个 `skills/<name>/SKILL.md`，不能仅凭仓库存在这些文件就判定安装包完整。

本地自动化检查不等同于真实模型行为或所有宿主客户端验收；CI 和发布结果以对应工作流的实际状态为准。

## CI 与发布

| 工作流 | 触发 | 行为 |
|---|---|---|
| `ci.yml` | push / PR 到 `main` | Node 22 与 24 双版本：`npm ci` → 语法检查 → `npm test` |
| `publish.yml` | 推送 `v*` tag | 校验 tag 与 `package.json` 版本一致 → 测试 → 包内容预览 → `npm publish` |
| `release.yml` | 推送 `v*` tag | 读取 `.version/RELEASE-<tag>.md` 作为正文创建 GitHub Release |

发布使用 npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers)（GitHub OIDC），仓库中不保存长期 token。

### 发布步骤

1. 按独立任务分批提交功能、测试和文档，每批先审查 diff，不混入无关文件。
2. 编写 `.version/RELEASE-v0.3.0.md`，列出上一标签以来的真实提交；版本说明不列发布提交自身。使用 `npm version 0.3.0 --no-git-tag-version` 同步包版本和 lockfile，不提前生成标签。
3. 完成适用测试、语法检查和 `npm pack --dry-run`，核实安装包内容；将版本号与版本说明作为独立发布提交。
4. 确认发布提交、分支和工作区状态正确后，创建 annotated tag 并推送。例如从已确认的 `main` 发布：

   ```bash
   git tag -a v0.3.0 -m "v0.3.0"
   git push origin main
   git push origin refs/tags/v0.3.0
   ```

5. 分别检查 CI、npm 发布和 GitHub Release 的实际结果。推送标签会触发公开 npm 发布与 GitHub Release 创建，两个发布工作流独立运行；标签推送成功或 Release 存在，不代表 npm 已发布成功。

`publish.yml` 要求：npm 包已存在且已配置 Trusted Publisher（GitHub 仓库 `cherish-ltt/dsh-dev-workflow`、工作流文件 `publish.yml`、环境 `npm`）；`repository.url` 与仓库地址一致；Runner 为 GitHub 托管；Node >= 22.14.0、npm >= 11.5.1。

## License

双协议并行，任选其一：

- [MIT](./LICENSE-MIT)
- [Apache-2.0](./LICENSE-APACHE)

SPDX 标识：`MIT OR Apache-2.0`
