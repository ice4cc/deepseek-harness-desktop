# @deepseek-ai/dsh-client-ui-doc-panel

[English](README.md) | 中文

Web GUI 的右侧文档面板：一个可折叠的网格分栏，用于渲染会话工作区中的 Markdown、HTML 与代码文件，并附带一个基于会话文件变更投影的固定「变更」页签。v1 为只读——面板只展示，从不编辑或保存。约定：[slot 系统标准](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md)。

插件通过声明感知的 `slots.inject()` 注册 AppFrame 声明的 `docPanel` single slot（位于会话列与详情列之间的分栏）：只要活的 owner 声明了该 seat，它就安装；随插件 fiber 卸载。分栏几何——开合、宽度（320–720px，默认 480）、拖拽调宽、窄视口下自动收起的让步链——都在布局 store 里；面板经跨插件的 `ctx.layout` 面（`openDocPanel`／`closeDocPanel`）触发开合。收起时分栏宽度为零，面板把重开图标按钮 portal 进框架的 overlay 层；展开后填满分栏，含头部（标题、自动跟随开关、收起控件）、页签栏与当前视图。

页签按路径寻址内容：多个会话打开同一文件共享一个缓存条目，因此每个路径只触发一次读取。每个会话持有自己有序的页签集合与激活选择（超过十个会话时按最近使用逐出）。页签形态由扩展名派生：`.md`/`.markdown` 渲染 Markdown 并提供「渲染／源码」切换，`.html`/`.htm` 渲染进无脚本的沙箱 iframe，其余一律成为代码页签，由包内自带的高亮分词器着色（JavaScript/TypeScript、Python、Bash、SQL、CSS、HTML/XML、YAML、JSON；未知语言回退为纯文本）。

Markdown 渲染器是一个小型自有解析器——标题、围栏与行内代码、粗体、斜体、链接、列表、引用、水平线——只由 React 元素构建（不使用 `innerHTML`），并在 `/`、`?`、`#` 之前出现冒号时拒绝该链接目标（如 `javascript:`、`data:`）。

「变更」页签聚合当前会话的 `fileChanges` 投影（[dsh-file-changes](../../session/file-changes/README.md)）：每个被改动路径一行，按最新排序，带新增／删除／编辑次数统计，并可展开经 ui-primitives DiffBlock 渲染的差异。行内显示 cwd 相对路径，原始路径挂在 title 上。点击某行即把该文件打开为页签。

自动跟随（默认开启）在投影中出现严格更新的改动时打开页签并展开面板；切换会话会重建按路径的 `lastAt` 基线表，因此既有变更不会涌入页签栏。读取走运行时的 `workspaces.readTextFile`；失败以其 wire 码呈现（`file-unreadable`、`file-too-large`、`binary-file`）。

store 是注册时声明的每 scope 独占工厂；组件经 `useStore` 读、经 `actions` 写。`/client` 导出只含插件主体（`apply`／`inject`）、约定类型与 store 工厂；DocPanelRoot、TabBar、ChangesTab、DocView 与各渲染器保持在包内。

## Model Experience

无——面板是纯客户端视图，只读取已落日志的会话数据；这里没有任何内容进入模型请求。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **v1 只读**——面板内不能编辑或保存；「变更」页签只展示差异，从不应用。
- **变更可见性绑定工具事件**——只有被投影折叠的 edit/write 工具结果会出现；bash 命令与手工编辑对该页签不可见。
- **目录浏览已推迟**——`listDirectory` wire API 只返回子目录，因此按目录浏览的页签需要先扩展 host 能力。
- **HTML 页签无脚本运行**——沙箱 iframe 不执行任何脚本且无同源访问；交互式文档只能静态渲染。
- **Markdown 非完整 CommonMark**——表格、任务列表、图片与超过一层的嵌套结构不被解析。
