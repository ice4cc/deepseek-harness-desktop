# Agent Note: 桌面壳标记改走 preload 桥，不再随 URL 传递

Status: implemented

[English](2026-08-30-desktop-shell-marker-rides-preload-bridge.md) | 中文

## Problem

桌面应用里窗口顶部条带不再能拖动窗口：会话打开时标题行上方的 44 px 条带、空白草稿 hero 页、侧栏品牌行全部失效。拖拽区域的 CSS 完好无损——页面只是从未收到桌面标记。

上游的[浏览器 launch-token 认证](../architecture/2026-08-24-browser-token-authentication.zh.md)把加载 URL 变成了一次性凭证：`GET /?token=...` 换取会话 cookie 后 303 重定向到干净的 `/`，剥掉全部查询参数。[桌面壳](../architecture/2026-08-16-desktop-shell-mode-a.zh.md)把 `?shell=desktop&os=<platform>` 追加在同一个 URL 上，于是标记死在重定向里，`<html>` 从未获得 `data-shell="desktop"`——没有标记，`.dragBand` 保持 `display: none`，侧栏品牌行不是拖拽区域，红绿灯避让规则也不生效。普通浏览器加载之所以一度不受影响，只是因为会话 cookie 已存在时（无重定向剥参数）查询参数还能存活。

## Decision

标记改走沙箱 preload 桥。`apps/desktop/src/preload.cjs` 在既有 `setThemeColors` 旁暴露 `window.dshDesktop.shell`（`'desktop'`）与 `.os`（Electron 主进程的 `process.platform`）；桥的存在本身就是标记。`apps/web/src/main.ts` 优先读桥，并据此给 `<html>` 打上 `data-shell="desktop" data-os="<platform>"`；普通浏览器加载带 `?shell=desktop&os=<platform>` 时仍可在会话 cookie 已建立的窗口内预览桌面布局（此时无重定向）。`createWindow` 原样加载就绪 URL——不再追加查询参数。

## Verification

对着启动的 `dsh web` 跑无头 Chromium：修复前，`/?token=...&shell=desktop&os=darwin` 被重定向到干净的 `/`，`<html>` dataset 为空，没有任何元素计算为 `-webkit-app-region: drag`；修复后，桥路径设置 `data-shell="desktop" data-os="darwin"` 且拖拽区域生效，查询参数兜底路径仍能给页面打标，普通加载保持标准布局。新增的无密钥 e2e 规格 `apps/web/tests/desktop-shell-marker.e2e.ts` 通过真实组合钉住两侧：注入的桥在 token 重定向后存活并给 `<html>` 打标，无桥则无标记。真实的窗口拖动仍属 Electron 专属（普通 Chromium 中 `-webkit-app-region` 无效）；用户可见的缺陷已在桌面应用本体上复现并清除。

## Alternatives considered

**在 303 Location 里转发 `shell`/`os`。** 否决——那要按着上游文档化的"重定向到干净 `/"`契约去改上游所有的 `browser-auth.ts`，每次主线同步都会重新冲突，而且让一个 UI 提示继续搭在一次性凭证 URL 上。

**让服务器按 cookie 记住标记参数。** 否决——那会把一次认证重定向变成会话状态，而消费者只有这一个标记。

**保留追加查询参数作为兜底。** 否决——首次加载之后它们是死重量：token 交换总会剥掉它们，同一事实的第二来源只会招致漂移。普通浏览器预览路径已覆盖手工 `?shell=desktop` 加载。

## Consequences

本 note 部分取代桌面壳 note 的 URL 标记机制（"壳在加载 URL 上追加 `?shell=desktop&os=<platform>`"）；该 note 的其余内容——拖拽条带几何、让位旗标、零宽折叠侧栏——不变。`window.dshDesktop` 在 `setThemeColors` 旁新增两个只读属性；两者都列在 `apps/desktop/README.md` 的上游同步表中。标记不再随 launch token 同行，复制出去的启动 URL 少一个不会存活的参数。
