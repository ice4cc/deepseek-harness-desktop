# Agent Note: Appearance settings section with chat content width levels

Status: implemented

[English](2026-08-23-settings-appearance-chat-width.md) | 中文

## Problem

Web GUI 的对话列只有一个固定的出厂宽度：`--dsh-chat-content-width`（748px），声明在 ui-conversation 的 `ConversationRoot` 里。大屏上想要更宽阅读列的用户没有任何控件——这个值藏在另一个包的一条 CSS 声明里，而设置面板也没有承载外观偏好的位置。

## Decision

新包 `@deepseek-ai/dsh-client-ui-settings-appearance` 通过 `ctx.slots.inject` 在 `settings.section` 席位上注册一个 `appearance`（外观）页签（id `appearance`，order 5，位于通用与模型之间）。页签只有一行：聊天内容宽度，三档——标准 / 宽 / 超宽。

档位是持久化偏好，存于设置命名空间 `ui-settings-appearance`（字段 `contentWidth`）：Node 半在存在 settings provider 时注册命名空间及其 zod schema，浏览器半通过 `ctx.settingsScope` 绑定。实时档位放在插件生命周期的 snapshot store 里，因为设置面板关闭时会卸载各页签组件。选择档位时发布到该 store 并写回字段；外部文档变更经共享 describe 镜像折回，行与覆盖样式同时收敛。

宽度本身由插件（而非页签组件）拥有的覆盖 `<style>` 表应用：宽与超宽向 `document.head` 注入 `div { --dsh-chat-content-width: <px>px !important; }`（880px / 1200px），标准档不注入任何样式。由于输入卡片宽度与居中 padding 都从同一变量派生，整条内容轴一致加宽。两个承重的选择：

- **标准档的含义是"不覆盖"，而不是钉死 748px。** 出厂默认值仍归 ui-conversation 所有；那个包改了默认值，标准档自动跟随，不必维护第二份数字。
- **`apply` 里采纳（adopt）与 CSS 应用（applyCss）是分开的两步。** 本地选择在其写入往返完成前就已发布，若在该路径上从 scope 快照采纳，会用仍然过期的持久值把刚做的选择回退掉（这个回归正是被插件 spec 抓住的）。采纳只在激活时与 scope 通知时执行；选择路径直接应用 CSS。

## Alternatives considered

**动态 Cordis 插件。** 本工作的原型：在单个会话里以进程内插件交付了同样的三档，但每次重启即消失、需要逐会话审批、且无法持久化选择——这个维护成本正是转向静态包的动因。

**会话级偏好（busyEnter 风格）。** 宽度是机器级的展示事实，不是会话属性：按会话存储会把一个视觉选择割裂到各会话，还要为一个永远不进模型请求的值引入提交设置机制。

**放进既有 general 页签的一行。** 用户要求独立的外观页签，且外观偏好（字号、密度）预计会继续增长；独立页签让 general 的行为开关保持干净。

## Consequences

纯展示层：任何档位都不改变 session 事件、草稿内容或请求载荷，模型请求与之前完全一致地渲染（记录在包 README 的 Model Experience 中）。覆盖样式把本包与 ui-conversation 的变量名耦合——这是跨包的展示契约而非数据契约；那个变量改名只需改这里一行。只有聊天内容轴加宽：trajectory 视图与 details 列保持各自宽度（README 限制）。settings RPC 仅限回环，远程浏览器以内存模式运行 scope——页签在那边可用但选择不会持久化（所有设置类偏好的共同限制）。若将来移除该包，设置文档中会残留一个 `ui-settings-appearance` 节；它带命名空间且无副作用。

## Testing

`packages/client/ui-settings-appearance/tests/`：`core.client.spec.ts` 覆盖档位→CSS 映射，`appearance-section.client.spec.tsx` 覆盖分段行（激活态、选择、外部 store 变更），`browser-plugin.client.spec.ts` 在真实 SlotRegistry 上覆盖插件（settings 传输在 `settingsScope` 边界打桩：席位延迟与拆卸、持久值采纳、选择写回、过期 scope 不回退、样式表创建/复用/移除），另有 host、invariant 与 locale 一致性 spec——逐文件 100% 覆盖率。`pnpm run test:gui` 全绿。新导航项使每个设置对话框 golden 恰好多出一个条目（经 `DSH_SNAPSHOT=refresh` 重录，diff 验证仅为该导航按钮）；`test:web` 的无密钥 `DSH_SNAPSHOT=replay` 回放除 `reference-composer.e2e.ts` 外全绿——该文件的 composer golden 失配（缺思考强度选择器）在干净树上同样失败，先于本变更存在。
