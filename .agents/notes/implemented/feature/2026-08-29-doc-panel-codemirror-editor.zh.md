# Agent Note: 文档面板代码编辑器——CodeMirror 6 与带守卫的编辑

Status: implemented

[English](2026-08-29-doc-panel-codemirror-editor.md) | 中文

## 问题

文档面板的代码视图曾用一个手写的行级 tokenizer 渲染文件，把源码分成五类 token run（comment / string / keyword / number / plain）——本变更将其退役。和聊天侧的观感相比很简陋：函数调用、属性、标点全部用默认色渲染；没有行号、代码折叠、文件内搜索和当前行高亮。高亮还是整文件同步进行的，多 MB 的文件（lockfile）会卡住帧。

产品目标是让文档面板达到 IDE 级的文件浏览体验——VS Code 里"打开一个文件来看"的那一半——并支持就地编辑，在 agent 操作同一棵树的期间安全地处理冲突。

## 决策

文档面板（[布局与页签模型](2026-08-28-doc-panel-grid-column.zh.md)）的代码渲染面是 CodeMirror 6，分三个阶段落地；本 note 取代 grid column note 里自有的代码分词器。聊天侧保持现有基于 Shiki 的 `CodeBlock` 不动；两个面的配色一致性靠主题 token 保证，不靠共享组件。

### Phase A — host 写通道

- 给 workspace-controller 的文本文件读值（`TextFileReadValue`，`packages/api/workspace-controller/src/types.ts`）加 `version` 新鲜度令牌；读路径本来就要 stat 取 size，令牌顺路带出。pre-release 阶段的 wire 扩展：不做兼容层。
- 新增 `ctx.remote.workspace.writeTextFile` 方法（`{ path, content, expectedVersion? }`），在 `packages/api/workspace-controller/src/commands.ts` 里挨着 `readTextFile` 实现。它直接写 node:fs（与读路径对称）：stat 提供新鲜度基线并证明目标是常规文件；传入的 `expectedVersion` 不再匹配时报 `file-stale-version`，目标缺失或非规规则报 `file-unwritable`；省略守卫即无条件覆盖（冲突横幅的"仍要覆盖"路径）。版本令牌（`dev:ino:size:mtimeMs:ctimeMs`）对 client 不透明——是一个回显守卫，不是带品牌的值。
- workspace-controller 新增 `Config` 字段限制单次写载荷字节数（`maxWriteBytes`），与读侧 `file-too-large` 上限（`maxTextBytes`）对称。
- controller 的 `@Remote('readTextFile')`／`@Remote('writeTextFile')` 方法（`packages/api/workspace-controller/src/index.ts`），以及 client 侧在 `readTextFile` 旁加的 `workspaces.writeTextFile()`（`packages/api/workspace-controller/src/client/service.ts`）。

### Phase B — CodeMirror 6 只读视图

- ui-doc-panel 依赖：`@codemirror/view` / `state` / `language`，外加 javascript / python / json / css / html / sql 的 Lezer 语言包；普通第三方库按依赖规则 bundle 进包的 `lib/client.js`。YAML 没有官方 Lezer 文法，保持纯文本。
- 新的 CodeEditor 组件替换 `code` 类 tab 里的 tokenizer：虚拟化渲染（只渲染可见行——大文件滚动流畅）、行号、当前行高亮、折叠 gutter、搜索、括号匹配。
- 主题：一个 `HighlightStyle` 加一个 `EditorView.theme`，颜色值引用现有的 `--shiki-*` / `--dsw-*` CSS 自定义属性（CodeMirror 的样式走 style 标签输出，`var()` 可解析）。面板因此与聊天代码块共用同一套色板，零新增字面色值；tokens-only 样式规则不破。
- 删除 `render/highlight.ts`、`.tok*` CSS 类和对应测试（~300+ 行自研 tokenizer 退役）。

### Phase C — 可编辑

- store（`store.ts`）：`DocTab` 加基线 `version`、`dirty`、`saving`、`writeError` 标志。文档文本留在 CodeMirror 自己的 state 里，绝不过 store——击键不能过 immer。
- Cmd/Ctrl+S 保存，调 `workspaces.writeTextFile` 并带 `expectedVersion` 守卫；成功则刷新基线 version 并清 dirty；tab 标题显示脏标记。面板的 apply 接线（`index.ts`）在 `readFile` 旁注入 save 回调，闭包捕获 `ctx.workspaces`。
- 冲突处理：保存被 `file-stale-version` 拒绝，或 tab 处于脏状态时 `fileChanges` 的 `lastAt` 发生变化（该 projection 本来就在按路径流式更新），就在 tab 顶部亮横幅——"文件在磁盘上被修改"——动作：重新加载 / 仍要覆盖 / 取消。覆盖是无条件写，不再二次确认：用户刚刚明确选过。
- 关闭脏 tab 时询问丢弃或取消。
- markdown/html 类 tab 在 v1 保持渲染视图；只有 `code` 类 tab 可编辑。

## 后果

- 代码面虚拟化渲染（只渲染可见行），多 MB 文件滚动不再整文件卡顿；行号、折叠、搜索、当前行高亮随之落地。
- 聊天与面板共用一套 token 驱动的色板：不建第二张色表，ui-doc-panel CSS 无新增字面色值。
- 手写 tokenizer（`render/highlight.ts`）及其测试已删除。
- CodeMirror 包体（~100 KB gzip）落在动态插件 chunk，不在启动关键路径——接受。

## 恒定约束

- 冲突检测复用 fs 能力的版本守卫语义（对 stat 派生令牌做 compare-and-swap），不发明新协议；host 用 kebab-case RPC 码（`file-stale-version`、`file-unwritable`）匹配读路径的域，而不是字面的 `FS_STALE_VERSION` 符号。
- 一套色板：CodeMirror 颜色引用 `--shiki-*` 变量，聊天与面板一致；不建第二张色表。
- 文档文本不逐击键进 store。
- 写大小上限做成 workspace-controller `Config` 字段（与读侧对称）。
- 冲突覆盖是直接写，不走 RiskConfirmation。

## 实施接缝

- Host：`packages/api/workspace-controller/src/types.ts`（`TextFileReadValue`、`TextFileWriteRequest`、`TextFileWriteValue`）、`src/commands.ts`（实现挨着现有 `readTextFile`，大小上限挨着读上限）、`src/index.ts`（`@Remote` 方法与 `Config` 面）。
- Client：`packages/api/workspace-controller/src/client/service.ts`（及其 contract 面）加 `writeTextFile`。
- 面板：`packages/client/ui-doc-panel/src/client/store.ts`（tab 字段 + actions）、`src/client/` 下新的 CodeEditor 组件、`views.tsx`（code tab 挂载）、`DocPanelRoot.module.css`（删 `.tok*`）、`render/highlight.ts`（删除）、`index.ts`（save inject prop）、`locales.ts`（横幅/文案）。

## 考虑过的替代方案

- 面板只换成 `CodeBlock`/Shiki：修好了配色，但没有行号/折叠/搜索，且保留整文件同步高亮（大文件卡顿）。不作为终点；Shiki 对聊天小片段依然是对的。
- Monaco（VS Code 编辑器内核）：minimap、IntelliSense、诊断都有——但把半个带 worker 的 VS Code 搬进浏览器，对只读浏览不成比例。只有需要 IntelliSense 级编辑时再重新评估。
- 保留手写 tokenizer 并丰富其配色：解决不了五类 token 的稀疏，也解决不了任何 IDE 能力缺失。

## 测试

- host 侧 `writeTextFile` 单测（stale version、大小上限、非文本路径），挨着现有读测试；store 状态机 spec 覆盖 dirty / save / conflict / close-guard。
- 一条 keyless e2e replay 场景（`apps/web/tests/doc-panel-edit.e2e.ts`）——打开一个产物文件、在 CodeMirror 里编辑、用快捷键保存，断言磁盘变化与基线刷新。它在真实 Playwright 浏览器里跑：jsdom 无法驱动 CodeMirror 输入（其输入路径调用 `Range.getClientRects`，而 jsdom 没有），所以击键编辑只能在活页面上模拟；组件 spec 改断言编辑器的用户可见面。
- 并发的外部修改以冲突横幅呈现，而不是静默覆盖；重新加载与覆盖两条路由 store spec 覆盖。
- 门槛：`pnpm run test:gui` 绿；`DSH_SNAPSHOT=replay pnpm run test:web` 绿，新增 host 单测通过。

## 风险

- agent/用户并发写是核心风险；由版本守卫加 `fileChanges` 前置横幅缓解。stat 与写之间落进来的外部写仍会报 stale——方向安全。
- jsdom 下测试 CodeMirror 能力有限；组件 spec 通过 store 和 DOM 输出断言用户可见行为，编辑器内部保持薄。
- 工作区当前带有一个与本 feature 无关的未提交修改（文档面板展开按钮 no-drag + 行对齐修复）；不要混进本 feature 的改动。
