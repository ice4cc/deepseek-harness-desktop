# Agent Note: 桌面拖拽条让位于打开的 portal 菜单

Status: implemented

[English](2026-08-19-desktop-drag-strips-yield-to-portal-menus.md) | 中文

## 问题

桌面壳里，会话列的空旷区域（空态 hero 面板，或打开会话后会话头上方的 44 px 条带）与侧栏品牌行是窗口拖拽条（[桌面壳说明](../architecture/2026-08-16-desktop-shell-mode-a.zh.md)）。Chromium 在浏览器进程中缓存拖拽矩形，只要 mousedown 落在其内就路由给窗口——即使有其他元素绘制在上方；而另一棵树的元素无法裁出条带自己的缓存矩形——这正是设置对话框在给自己的层声明 no-drag 之外，还需要 `<html data-settings-open>` 标记加各条带让位的原因。

`Menu` 的 portal 模式把列表渲染进 `document.body`——与每条拖拽条都不在同一棵树。新建会话的 hero 上，agent-preset 座位菜单正开在 hero 面板之上：与输入卡片重叠的行（条带子树内部裁出的 no-drag 孔洞）能收到点击，而垂在卡片下方的行——极简模式、创造模式——落在裸的拖拽区上，永远收不到指针事件；mousedown 拖动的是窗口，用户便感到这些行被挡住、无法选中。任何开在拖拽条之上的 portal 菜单（工作区选择器、权限行、JsonTree）都有同样的窟窿，连外点关闭也不例外：本意是关闭菜单的点击同样被窗口吞掉。

## 决策

打开的 portal 菜单在其打开存续期间给 `<html>` 打上 `data-portal-menu-open` 标记。`ui-primitives` 的 Menu 自行设置与清除该标记——一个模块级引用计数：portal 菜单打开时递增、关闭或卸载时递减，计数归零时移除属性——使两个同时打开的菜单不会互相取消标记。就地（非 portal）菜单不打标记：它们渲染在自己所在的树内，条带对可交互后代的 no-drag 裁出已覆盖其行。

每条桌面拖拽条在自己的模块 CSS 里为标记存续期间让位：`ConversationRoot.module.css` 中的会话 `.dragBand` 与 hero `.scrollBody`，`SidebarRoot.module.css` 中的侧栏 `.logoRow`——每处均为 `:global(html[data-shell='desktop']:is([data-settings-open], [data-portal-menu-open]))`，与设置对话框同一让位模式。portal 菜单打开期间，菜单之外的条带区域点击会到达页面并关闭菜单，而不是拖动窗口。纯 web 壳加载没有拖拽区，忽略该标记。

## 验证

`ui-primitives` 的 `Menu` 规格（`tests/atoms.client.spec.tsx`）钉住标记生命周期：打开的 portal 菜单设置该属性，打开的就地菜单不设置，两个同时打开的 portal 菜单在一个关闭后仍保持标记，最后一个关闭时移除。`pnpm run test:gui` 为绿。点击被吞本身是 Chromium 的缓存拖拽矩形行为——桌面壳说明中设置对话框标记与 portal 悬浮按钮修复所针对的同一已记录行为——而 Playwright Chromium 泳道中 `-webkit-app-region` 无效果，无法复现。用户可见的缺陷是：桌面应用空态 hero 上，从 preset 菜单选极简模式或创造模式时拖动的是窗口，而不是选中模式。

## 备选方案

**仅在 portaled 列表自身声明 no-drag。** 否决——另一棵树的元素无法裁出条带的缓存矩形。这正是设置浮层记录的教训：它自己的 no-drag 覆盖挂载在拖拽条内部的层，而仅在屏幕空间位于其下的条带必须由标记清除——这是移除另一棵树所拥有的矩形的唯一可靠方式。

**座位菜单就地渲染（不用 portal）。** 否决——portal 模式存在的原因就是就地列表会被溢出裁剪的祖先裁掉（hero 面板位于滚动体这一滚动容器之内）。就地渲染时，菜单还会成为条带子树的滚动内容子节点，其卡片边框——内边距、行间空隙——会继承 `drag`。窟窿只会移动，不会消失。

**条带仅在菜单自身矩形范围内让位。** 否决——缓存矩形只能整体移除，不能在点击时按矩形逐一处置。整个条带在菜单打开存续期间让位，与设置对话框接受的政策相同：透过打开的浮层拖动窗口不是受支持的手势。

**每个菜单站点各用一个标记（仅 preset 座位）。** 否决——每个 portal 菜单（工作区选择器、权限行、JsonTree）都开在这些条带之上；信号应属于它们共同经过的 portal 机制，而非某一个消费者。

## 后果

任一 portal 菜单打开期间，桌面拖拽条无法拖动窗口；其上的点击到达页面并关闭菜单。这是被接受的权衡，与设置对话框相同。`data-portal-menu-open` 是新的跨包契约：`ui-primitives` 设置它，`ui-conversation` 与 `ui-sidebar` 在各自模块 CSS 中消费它，两侧均列入 `apps/desktop/README.md` 的上游同步表。未来开在拖拽条之上的可交互 portal 浮层（带可操作内容的 HoverCard）需要同一标记。
