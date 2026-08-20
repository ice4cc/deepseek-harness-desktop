# @deepseek-ai/dsh-client-ui-think-tag

[English](README.md) | 中文

Composer think-tag 控件：占用 `conversation.input.right` 的 tool-row seat（composer 卡片内，位于 model seat 与发送按钮之前）。触发器显示标准 Think 图标与当前 level 标签；下拉菜单提供四个 inline level（不思考 / 简短 / 标准 / 深度），外加「会话默认」。

## 机制

选择某个 level 会经公开的 `setDraft` action 改写 draft 尾部的 `<|think_*|>` 标签——标签在文本框中可见（model 可见内容即被记录的 draft 内容，所以输入 machine、transcript 与 wire 载荷都带上它，无需 submission-pipeline hook），chat template 在渲染时将其剥离。「会话默认」移除标签，强度交回 provider/会话的 `reasoning_effort` 决定。出现在 draft 中部的标签按普通文本处理：只扫描并改写尾部 span，用户正文绝不被触碰。

无当前会话时（owner zone 缺席）控件自身不渲染任何内容；标签是 per-draft 值，不跨会话持久化，会话配置的 effort 保持默认生效。

## 模型体验

### 携带 think 标签的用户消息

#### 模型看到的内容

尾部 `<|think_*|>` 标签不会进入渲染后的 prompt：froggeric chat template 将其剥离，转而把该消息的 reasoning 强度设为所选 level。带标签的消息以用户纯文本的形式到达模型；未带标签的消息原样渲染，仍由 provider/会话的 `reasoning_effort` 决定。

#### Token 影响

wire 上传输时，标签作为用户消息体尾部的一个 token 片段；template 将其剥离，渲染后的 prompt 不含标签 token。所选 level 改变的是模型为该消息产生的 reasoning 量，而非 prompt 大小；发送前切换 level 不消耗任何 token。

#### KV Cache 影响

标签位于 draft 末尾，消息前缀（system + history）不变，prefix caching 不受影响；切换 level 只追加/替换当前消息尾部的 token 片段。

## 已知限制与暂缓事项

- **仅 draft、逐条消息**——标签不跨消息或跨会话持久化；反复打标即为预期工作流（会话级覆盖属于 settings 平面的功能，不属于本插件）。
- **draft 中部的标签不生效**——出现在正文中间的标签对模型保持字面文本；只有尾部 span 受控。
- **依赖 template 支持**——chat template 不剥离 `<|think_*|>` 标签的 provider 会把字面标签当作用户正文呈现给模型；控件不检测、也不以 template 能力做门控。
