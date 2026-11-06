# Release v0.4.0

新增任务原生附件、同会话确认恢复、可关闭的全局规则追加，以及带逐项 Markdown 预览的多选决策。

## 变更

- 五个任务命令支持图片、文件与混合附件；首次理解、修正、补充及执行复用宿主已经接纳的有序引用，不新增上传或存储通道（[#1](https://github.com/cherish-ltt/dsh-dev-workflow/issues/1)，[PR #7](https://github.com/cherish-ltt/dsh-dev-workflow/pull/7)）。
- 新增 `/dev-resume`，在同一宿主进程的原会话中恢复最近一次完整待确认报告，重新确认后按原命令执行一次；输入或目录变化先重新分析，拒绝迟到答案、并发恢复与重复执行（[#2](https://github.com/cherish-ltt/dsh-dev-workflow/issues/2)，[PR #8](https://github.com/cherish-ltt/dsh-dev-workflow/pull/8)）。
- 仅接纳与原输入对应、成功结束的分析轮次；中断、截断和工具调用片段不作为完整报告。正常确认卡不重复主对话报告，恢复卡只显示任务信息及未重新核实提示。
- 新增 `appendSystem` 布尔配置，默认开启；关闭后保留五个任务命令、恢复命令、`dev_ask` 与三个 Skill，配置及卸载沿用宿主生命周期（[#3](https://github.com/cherish-ltt/dsh-dev-workflow/issues/3)，[PR #6](https://github.com/cherish-ltt/dsh-dev-workflow/pull/6)）。
- `dev_ask` 可显式启用 `multiSelect`，完整返回所选标签数组和补充文本；未启用时保留原单选 `string|null` 结果（[#5](https://github.com/cherish-ltt/dsh-dev-workflow/issues/5)，[PR #9](https://github.com/cherish-ltt/dsh-dev-workflow/pull/9)）。
- 多选预览与勾选集合独立；专属载荷标识兼容 DSH 官方 Markdown 渲染器，普通“选项 N”标题不会被误拆分，切题和卸载释放监听器并恢复详情。鼠标实际移动可切换预览，布局产生的指针边界事件不覆盖键盘焦点。
- 按用户反馈[拒绝并关闭 #4](https://github.com/cherish-ltt/dsh-dev-workflow/issues/4#issuecomment-6681193686)：不在意图确认对话框重复展示完整报告，完整内容继续在主对话查看。

## 验证

- 独立工作树使用官方 npm registry 完成干净安装，完整八套 `npm test` 通过，包括 39 项确认恢复、31 项工具 schema 和 48 项客户端检查；其余覆盖命令、原生附件、配置、Skill 与版本记录。
- 四个功能 PR 的 Node 22/24 CI 均通过；功能整合仅处理未发布日志追加冲突，最后一次 Squash 后的主分支内容与已验收内容一致。
- 官方 DSH `0.2.1-rc.5` Web 实测图片与文本混合上传、确认恢复、修正后重新分析、补充后执行；首次分析、修正分析、执行三个请求保留相同附件引用，只有一次执行。浏览器断线导致原命令中止后，原进程 `/dev-resume` 可再次确认。
- Web 普通确认卡不展示完整报告；恢复卡仅展示原命令、任务、目录、时间及未重新核实提示。真实 Cordis Loader 验证 `appendSystem` 配置与重新加载。
- Web 实测双选、Tab 到无预览项收栏、Shift+Tab 回到报告、撤选后查看、600×800 窄屏长 Markdown 末尾、多行补充与双选一起提交、明确放弃后不产生答案。官方生产 Markdown 渲染器验证载荷边界；普通详情、重绘与卸载由回归测试覆盖。
- `lib/*.js`、`test/*.mjs` 语法检查、版本记录与 `git diff --check` 通过；打包预览包含确认恢复模块和三个完整 `SKILL.md`。
- 本地环境为 macOS arm64、Node `26.13.0`、npm `11.20.0`；Linux Node 22/24 由 CI 验证。初次 registry 访问受沙箱网络限制，授权后安装成功；两份旧 PNG 夹具被宿主完整解码检查拒绝，替换为有效 2×2 PNG 后附件流程通过，未放宽产品校验。

## 兼容与限制

- 继续精确支持 DSH `0.2.1-rc.5`，没有升级宿主依赖或新增运行时依赖；其他宿主版本和客户端需要独立验证。
- `/dev-resume` 只支持同进程、原会话的确认阶段，每会话最近一项，最多保留 32 个会话。进程重启、插件重载及执行阶段恢复不在范围内，不新增持久化。
- Web 验收使用官方宿主、官方客户端和本地确定性模型适配器；附件传输与交互成功不等于真实模型理解正确，提示词约束不等于文件系统沙箱。
- 最终独立鼠标悬停复验因 Chrome 自动审批连续超时未执行，鼠标移动事件由客户端回归覆盖；真实鼠标点击和键盘流程已验证。Web 的 Esc 未触发取消，应使用卡片取消选项或“放弃整组问题”按钮；插件不接管宿主快捷键。
- 多选调用方需处理新增的结构化答案；单选接口保持兼容。普通多选也可直接使用宿主原生工具。
- 标签触发 GitHub Release 和 npm Trusted Publishing，两项工作流独立，实际发布结果应分别核实。

## Commit History

```text
9933077 feat: 允许单独关闭追加全局规则 (#6)
8f18b58 feat: support native attachments in dev commands (#7)
2b7edbe feat: resume pending intent confirmation in the original session (#8)
83cc418 feat: support multi-select decisions with independent Markdown previews (#9)
```

署名：GPT-6-Astra-Ultra
