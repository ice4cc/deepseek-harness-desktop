---
description: "Web GUI 的文档面板：一个可折叠分栏，渲染会话工作区中的 Markdown、HTML 与代码文件，代码页签可编辑并带冲突守卫，另附固定的「变更」页签；面向 Web 文件浏览体验的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-doc-panel

[English](README.md) | 中文

## 概述

本包为 Web GUI 提供右侧文档面板：会话旁一个可折叠分栏，用于浏览会话工作区文件。Markdown 以「渲染／源码」切换渲染，HTML 渲染进无脚本的沙箱 iframe，代码在 CodeMirror 6 编辑器中打开，可编辑并以冲突守卫保存。固定的「变更」页签列出当前会话触碰过的每个文件并可展开差异；自动跟随（默认开启）会在 agent 工作时打开页签。面板是纯客户端视图：读写走 workspace controller 的文本文件面，这里没有任何内容进入模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 web-app 模块表中挂载该插件行；它等待 AppFrame 声明 `docPanel` slot，只要活的 owner 声明了该 seat 就安装自己。此后分栏、页签与「变更」页签即告就绪，无需额外接线。

### 页签与视图

页签按路径寻址内容：多个会话打开同一文件共享一个缓存条目，因此每个路径只触发一次读取。每个会话持有自己有序的页签集合与激活选择（超过十个会话时按最近使用逐出）。页签形态由扩展名派生：`.md`/`.markdown` 渲染 Markdown 并提供「渲染／源码」切换，`.html`/`.htm` 渲染进无脚本的沙箱 iframe，其余一律成为代码页签。

Markdown 渲染器是一个小型自有解析器——标题、围栏与行内代码、粗体、斜体、链接、列表、引用、水平线——只由 React 元素构建（不使用 `innerHTML`），并在 `/`、`?`、`#` 之前出现冒号时拒绝该链接目标（如 `javascript:`、`data:`）。

### 编辑与保存

代码页签在 CodeMirror 6 中打开：虚拟化渲染（仅可见行，多兆字节文件滚动流畅）、行号、活动行高亮、折叠、搜索与括号匹配。Lezer 语法覆盖 JavaScript/TypeScript、Python、JSON、CSS、HTML 与 SQL；YAML 与未知语言按纯文本渲染。文档正文只存在于编辑器自身状态，从不进入 store。

Cmd/Ctrl+S 保存经 `workspaces.writeTextFile` 写入，带 `expectedVersion` 守卫——一个由 stat 派生、从读取回显的 token。成功后刷新基线版本并清除页签标题上的 dirty 标记。保存被判定为过期、或页签 dirty 期间投影出现新触碰，都会弹出冲突横幅，提供重新加载／覆盖／取消；覆盖即无条件写入，因为你刚刚做出了选择。关闭 dirty 页签会询问丢弃或取消。

### 「变更」页签

「变更」页签聚合当前会话的 `fileChanges` 投影（[dsh-file-changes](../../session/file-changes/README.zh.md)）：每个被改动路径一行，按最新排序，带新增／删除／编辑次数统计，并可展开经 ui-primitives DiffBlock 渲染的差异。行内显示 cwd 相对路径，原始路径挂在 title 上。点击某行即把该文件打开为页签。

### 自动跟随

自动跟随（默认开启）在投影中出现严格更新的改动时打开页签并展开面板；切换会话会重建按路径的 `lastAt` 基线表，因此既有变更不会涌入页签栏。读取走 `workspaces.readTextFile`；失败以其 wire 码呈现（`file-unreadable`、`file-too-large`、`binary-file`）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件通过声明感知的 `slots.inject()` 注册 AppFrame 声明的 `docPanel` single slot（位于会话列与详情列之间的分栏）：只要活的 owner 声明了该 seat，它就安装；随插件 fiber 卸载。分栏几何——开合、宽度（320–720px，默认 480）、拖拽调宽、窄视口下自动收起的让步链——都在布局 store 里；面板经跨插件的 `ctx.layout` 面（`openDocPanel`／`closeDocPanel`）触发开合。分栏 body 在两种状态下都保持挂载：收起时轨道动画到零宽度并将其裁剪（body 在收起期间为 `inert`），portal 进框架 overlay 层的持久重开图标按钮隐藏；展开后 body 填满分栏，含头部（标题、自动跟随开关、收起控件）、页签栏与当前视图。

store 是注册时声明的每 scope 独占工厂；组件经 `useStore` 读、经 `actions` 写。`/client` 导出只含插件主体（`apply`／`inject`）、约定类型与 store 工厂；DocPanelRoot、TabBar、ChangesTab、CodeEditor 与各渲染器保持在包内。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | slot 注册；闭包 `ctx.workspaces` 的读／保存回调 |
| [`src/client/store.ts`](src/client/store.ts) | 页签状态机：内容、基线版本、dirty/saving 标志、冲突状态 |
| [`src/client/CodeEditor.tsx`](src/client/CodeEditor.tsx) | CodeMirror 6 视图，含主题 token 与保存快捷键 |
| [`src/client/ChangesTab.tsx`](src/client/ChangesTab.tsx) | 投影行与 DiffBlock 展开 |
| [`src/client/locales.ts`](src/client/locales.ts) | `docPanel` locale 命名空间内的面板文案 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [ui-layout](../ui-layout/README.zh.md) — 声明 `docPanel` 分栏 seat 并拥有其几何。
- [dsh-file-changes](../../session/file-changes/README.zh.md) — 「变更」页签背后的投影。
- [文档面板代码编辑器笔记](../../../.agents/notes/implemented/feature/2026-08-29-doc-panel-codemirror-editor.zh.md) — CodeMirror 决策与带守卫的写入缝。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md) — 浏览器插件行如何加载并注册 slot。
- [工作区子系统页](../../../docs/subsystems/workspace.zh.md) — 文本文件读／写 wire 面。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该插件只在客户端面板中渲染与编辑会话工作区文件，不贡献任何模型可见输入。

#### KV Cache 影响

无；本包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>


这些限制界定当前面板面。它们是包约束，不是通用编辑器对比或任务清单。

- **仅代码页签可编辑** — markdown/html 页签保持渲染视图；编辑限于 code 类页签。
- **变更可见性绑定工具事件** — 只有被投影折叠的 edit/write 工具结果会出现；bash 命令与手工编辑对该页签不可见。
- **目录浏览已推迟** — 面板仅按路径打开文件；按目录浏览的视图需要自己的 host 能力。
- **HTML 页签无脚本运行** — 沙箱 iframe 不执行任何脚本且无同源访问；交互式文档只能静态渲染。
- **Markdown 非完整 CommonMark** — 表格、任务列表、图片与超过一层的嵌套结构不被解析。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
