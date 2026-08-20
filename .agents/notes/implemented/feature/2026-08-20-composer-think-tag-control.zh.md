# Agent Note：composer think-tag 控件与 conversation.input.right 座位

状态：implemented

[English](2026-08-20-composer-think-tag-control.md) | 中文

## 问题

Web composer 没有任何面向用户的逐条消息 reasoning 强度控制。provider/会话的 `reasoning_effort` 是会话级的选择，用户想让某一条消息深度思考（或完全不思考）时没有办法表达，而且这个选择不可见：draft、transcript 与 wire 载荷中都没有任何内容表明这条消息将以何种强度发送。

## 决策

新包 `@deepseek-ai/dsh-client-ui-think-tag` 经 `ctx.slots.inject('conversation.input.right', ...)` 在 `conversation.input.right` 座位（composer 卡片内、model seat 与发送按钮之前）注册一个 tool-row 条目。控件用 `src/client/core.ts` 的纯函数（`thinkLevelOf` / `setThinkLevel`）经公开的 `setDraft` 输入 action 改写 composer draft 的尾部 span；它没有 store、不注册任何事件、没有任何 host 侧行为（node 半是空 apply）。

level 以追加到 draft 的 inline `<|think_off|>` / `<|think_low|>` / `<|think_medium|>` / `<|think_xhigh|>` 标签形式落地。model 可见内容即被记录的 draft 内容，所以标签沿既有的 model 可见通道走完全程：输入 machine、session 日志与 wire 载荷都携带它，无需任何 submission-pipeline hook；replay 逐字重放带标签的 draft。froggeric chat template 在渲染时把标签从 prompt 中剥离，并根据它推导该条消息的 reasoning 强度。「会话默认」移除标签，把决定权交回 provider/会话的 `reasoning_effort`。

只扫描尾部 span：出现在 draft 中部的标签对模型是字面文本，绝不被改写。标签是 per-draft 值——控件除自身下拉的开合外不持有任何状态；无当前会话时（owner zone 缺席）不渲染任何内容。会话级 effort 词汇表（`ReasoningEffortId`）、请求头的日志记录与兜底选择仍归 [adapter 主导的 reasoning effort 能力](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md) 所有；标签是按条消息补充该机制，而不是取代它。

## 备选方案

**发送时从会话级 UI 选择注入标签。** submission-pipeline hook 会在 draft 之外追加标签，破坏 model 可见 ⟺ 已记录：transcript 无法重建带标签的消息，replay 会去掉标签。会话级选择还意味着一个本就 per-draft 的值需要额外的 store 与 settings 行。

**会话级 settings 行（agent-preset 样式）。** 跨消息持久化覆盖值属于 settings 平面，owner 与生命周期都不同；按条打标才是这里预期工作流（会话级覆盖被推迟，记录在包 README 的局限中）。

**客户端剥离标签、把 level 挂到请求设置上。** 这需要新的 model 可见输入（因此是新的 session 事件）或没有文档的 wire 字段；draft 已经是 model 可见内容的法定载体。

## 后果

composer 的 a11y 树在 access 模式控件与 model seat 之间多了一个按钮；41 个 composer 面 Web golden 记录了该触发器（`DSH_SNAPSHOT=replay` 下 keyless 重放）。一条带标签的消息在 wire 上多一个尾部 token 片段，prompt 无额外 token——template 会剥离它——发送前切换 level 零成本，消息前缀（system + history）不受影响、prefix caching 不变。chat template 不剥离 `<|think_*|>` 标签的 provider 会把字面标签当作用户正文呈现；这一点记录在包 README 中且刻意不做门控。

## 测试

`packages/client/ui-think-tag/tests/`：`core.client.spec.ts` 覆盖纯标签逻辑，`think-tag-control.client.spec.tsx` 覆盖 driven 输入 store 上的组件行为（level 标签、选择/替换/清除/无操作、外侧点击与 Escape 关闭、非 Escape 键、无输入 machine 的守卫——包内逐文件 100% 覆盖），`browser-plugin.client.spec.ts` 覆盖经 client runtime 的插件启动。组装层面经 `DSH_SNAPSHOT=refresh` 重新录制，并以 Web 套件的干净 `DSH_SNAPSHOT=replay` 通过验证。
