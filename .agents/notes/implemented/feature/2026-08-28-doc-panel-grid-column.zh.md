# Agent Note：作为布局网格分栏的右侧文档面板

Status: implemented

[English](2026-08-28-doc-panel-grid-column.md) | 中文

## Problem

Web GUI 此前没有任何界面能在会话旁边阅读工作区文件：用户想在干活时预览一个 Markdown 文档、HTML 产物或源码文件，只能离开页面。需求以「一个插件，在右侧增加可折叠区域，多页签展示文档，支持代码高亮、Markdown 与 HTML 渲染」的形式提出。

## Decision

静态客户端包 `@deepseek-ai/dsh-client-ui-doc-panel` 通过声明感知的 `ctx.slots.inject()` 注册 AppFrame 的 `docPanel` single slot——位于会话列与详情列之间的分栏。分栏几何归 ui-layout 所有，而非面板：布局 store 持有开合状态与宽度（320–720px，默认 480），拖拽调宽走分栏边界上的浮动胶囊手柄，让步链先让详情栏（瞬时）再让文档面板（用户持续意图），视口变窄时各自自动关闭到零宽度、变宽后从存储偏好恢复。面板经跨插件的 `ctx.layout` 面（`openDocPanel`／`closeDocPanel`）触发开合。收起时分栏宽度为零，面板把重开图标按钮 portal 进框架的 overlay 层；展开后填满分栏，含头部（标题、自动跟随开关、收起控件）、页签栏与当前视图。两个切换按钮均与侧边栏同款：无边框圆形图标按钮（镜像版 `IconPanelRightOutline16`）；其 tooltip 一律向下放置（`side="bottom"`），因为在视口右边缘，默认的右侧气泡会被挤回盖住锚点、吞掉点击的 mouseup——mousedown 聚焦会立即显示气泡。

页签按路径寻址内容：每个文件一个全局缓存条目，每个会话一套有序页签集合加激活选择（超过十个会话按最近使用逐出）。形态由扩展名派生——Markdown（渲染／源码切换）、HTML（无脚本沙箱 iframe）、代码（CodeMirror 6 带守卫编辑——[文档面板代码编辑器](2026-08-29-doc-panel-codemirror-editor.zh.md)）。

面板带一个固定的「变更」页签，聚合当前会话的 `fileChanges` 投影（[dsh-file-changes](../../../../packages/session/file-changes/README.zh.md)）：每个路径一行，带新增／删除／编辑次数统计，可展开经 ui-primitives DiffBlock 渲染的差异；点击某行即打开该文件。自动跟随（默认开启）对严格更新的改动打开页签并打开面板分栏，切换会话时重建按路径的 `lastAt` 基线表，既有变更不会涌入页签栏。读取走运行时的 `workspaces.readTextFile`，由 API 网关在任意组合的 picker kind 下直接从宿主文件系统提供——刻意不作为目录选择能力的一部分，因为原生桌面同样要能打开自己变更的文件；失败以其 wire 码呈现。

承重的选择：

- **页签按路径而非按会话缓存内容。** 两个会话打开同一文件共享一个缓存条目与一次在途读取；每会话的状态只有有序页签集合与激活 id。按会话的内容缓存在每次切换会话时都会重读文件，对用户毫无可见收益。
- **Markdown 渲染器是自有、元素构建的，而非外部解析库。** 全程不用 `innerHTML`：块与行内 run 由小型块／行内两遍解析直接生成 React 元素；在首个 `/`、`?`、`#` 之前出现 scheme 的链接目标一律拒绝。完整 CommonMark 依赖换来表格与任务列表，代价是这个面板用不到的安全面（HTML 透传选项）；缺口记在 README 里而不是引入依赖。
- **面板几何放在布局 store，而非面板自己的 store。** 窄视口自动关闭与变宽恢复是网格求解器让步链的性质；绝对定位的栏无法参与其中。面板自己的 store 只保留查看状态（自动跟随开关、每会话页签集合、内容缓存）。

## Alternatives considered

**动态 Cordis 插件。** 需求的字面读法。先做了对 Codex 同类界面的比较研究，再回到仓库自身约定：GUI 功能以静态客户端包交付，因为进程局部插件重启即消失、需要逐会话审批、也无法持有持久的 UI seat。原型阶段被放弃，改为本包。

**面板内编辑。** 经同一轮比较研究后从 v1 砍掉：编辑器需要对并发工具编辑的冲突策略、wire 上的保存语义与脏状态模型——客户端读路径上这些都不存在。v1 严格只读；「变更」页签只展示差异，从不应用。

**目录浏览页签。** 砍掉：`listDirectory` wire API 只返回子目录（文件被过滤掉），按目录浏览到文件需要先扩展 host 能力。记为推迟工作，而不是为 v1 扩 host。

**overlay seat（同日第一版）。** 最初的设计向 `shell.overlay` 注册一个带 key 的条目：悬浮在右缘之上的栏，自带宽度状态，收起时是右缘把手。评审中被否：用户更偏好 IDE 式分栏——会话与文档并排；而且悬浮 overlay 无法加入布局的让步链——窄视口自动关闭与变宽恢复是网格求解器的性质。重开 affordance 从右缘把手改为 portal 进 overlay 层的图标按钮，该层仍留给真正需要悬浮的表面。

## Consequences

纯呈现：无会话事件、请求负载或投影变化；模型请求与之前完全一致（README Model Experience）。包耦合三个跨包事实——ui-layout 拥有的 `docPanel` slot 名与布局 store 几何、runtime sessions store 拥有的 `fileChanges` 投影键，都是稳定的组合契约。变更可见性绑定工具事件：bash 命令与手工编辑不会出现在页签里（README 限制）。HTML 页签不执行任何脚本。移除本包只留下一个惰性的 `docPanel` locale 命名空间；AppFrame 继续渲染那个空的分栏 seat（零宽度、无占用者）。

## Testing

`packages/client/ui-layout/tests/`：四列求解器 spec（让步顺序详情先于文档面板、自动关闭各步、面板关闭时的向后兼容）、AppFrame spec（docPanel seat 的 owner props、拖拽向左加宽、各开合状态下的手柄数量）、布局 store 与 service spec（宽度夹取、开合）。`packages/client/ui-doc-panel/tests/`：store spec（页签集合生命周期、逐出、内容／错误落地——无 expanded 标志）、渲染器与组件 spec、在真实 store 引擎加可变 sessions fixture 上的 DocPanelRoot spec（portal 重开按钮、owner 驱动的收起、自动跟随基线／跟随／重基线并打开面板分栏、cwd 解析、打开即读去重、无会话渲染），以及在真实 SlotRegistry 上的 apply spec（迟到声明安装、折叠移除、卸载、`ctx.layout` 接线）——逐文件 100% 覆盖。`pnpm run test:gui` 绿；`test:web` 的 keyless `DSH_SNAPSHOT=replay` 通过是新增分栏 seat 的组装浏览器检查。
