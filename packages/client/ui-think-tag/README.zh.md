---
description: "Web GUI 的 composer think level 控件：一个 tool-row seat，改写 draft 尾部的 <|think_*|> 标签，让每条消息携带显式 reasoning 强度；面向 composer 体验的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-think-tag

[English](README.md) | 中文

## 概述

本包在 composer 行里放了一个 think level 控件：占用 `conversation.input.right` 的一个 seat，位于 composer 卡片内、model seat 与发送按钮之前。你可以为即将发送的消息选择模型思考的强度——不思考、简短、标准或深度——或回到会话默认。选择以尾部 `<|think_*|>` 标签的形式搭载在 draft 上：它在文本框中可见、随 draft 落日志，并在渲染时被 chat template 剥离，转而设置该消息的 reasoning 强度。无需任何 submission-pipeline hook；标签就是普通的 model 可见 draft 内容。

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

在 web-app 模块表中挂载该插件行；它等待 conversation composer 声明 `conversation.input.right`，并把控件安装到那里。触发器显示标准 Think 图标与当前 level 标签；下拉菜单提供四个 inline level 外加「会话默认」。

### 选择 level

选择某个 level 会经公开的 `setDraft` action 改写 draft 尾部的 `<|think_*|>` 标签。因为 model 可见内容即被记录的 draft 内容，输入 machine、transcript 与 wire 载荷都带上该标签，无需任何 pipeline hook；chat template 在渲染时将其剥离。「会话默认」移除标签，强度交回 provider/会话的 `reasoning_effort` 决定。出现在 draft 中部的标签按普通文本处理：只扫描并改写尾部 span，用户正文绝不被触碰。

### 会话边界

无当前会话时（owner zone 缺席）控件自身不渲染任何内容。标签是 per-draft 值：不跨会话持久化，会话配置的 effort 保持默认生效。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件通过声明感知的 `slots.inject()` 在 `conversation.input.right` 上注册自己的 seat：composer 声明该 zone 时安装，随插件 fiber 卸载。触发按钮与下拉菜单是纯展示：level 状态从 draft 文本本身派生（尾部标签），让被记录的 draft 成为唯一事实源，而非第二个 store。选择 level 时组合出新的 draft 文本并调用 owner 的 `setDraft` action；没有其他通道移动数据。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | slot 注册与 inject 面（draft 访问、`setDraft`） |
| [`src/client/core.ts`](src/client/core.ts) | 纯 draft 标签操作：level 检测与尾部 span 改写 |
| [`src/client/ThinkTagControl.tsx`](src/client/ThinkTagControl.tsx) | seat 上的触发按钮 + level 下拉菜单 |
| [`src/client/locales.ts`](src/client/locales.ts) | `thinkTag` locale 命名空间内的 level 标签 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [ui-conversation](../ui-conversation/README.zh.md) — 拥有 composer 卡片并声明 `conversation.input.right` zone。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md) — 浏览器插件行如何加载并注册 slot。
- [客户端包地图](../README.zh.md) — 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经由 draft 尾部的 `<|think_*|>` 标签：chat template 在渲染时将其剥离，并以该消息的 reasoning 强度取而代之；控件本身不注册任何 prompt、schema 或 tool。

#### KV Cache 影响

标签位于 draft 末尾，消息前缀（system + history）不变，prefix caching 不受影响；切换 level 只追加/替换当前消息尾部的 token 片段。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>


这些限制界定当前控件面。它们是包约束，不是通用 reasoning 模式对比或任务清单。

- **仅 draft、逐条消息** — 标签不跨消息或跨会话持久化；反复打标即为预期工作流（会话级覆盖属于 settings 平面的功能，不属于本插件）。
- **draft 中部的标签不生效** — 出现在正文中间的标签对模型保持字面文本；只有尾部 span 受控。
- **依赖 template 支持** — chat template 不剥离 `<|think_*|>` 标签的 provider 会把字面标签当作用户正文呈现给模型；控件不检测、也不以 template 能力做门控。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
