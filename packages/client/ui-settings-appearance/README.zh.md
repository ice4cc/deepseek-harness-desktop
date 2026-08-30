---
description: "Web GUI 的外观设置分区：一个持久的聊天内容宽度偏好，三个档位（标准／宽／超宽）；面向设置面板的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-appearance

[English](README.md) | 中文

## 概述

本包为设置面板添加一个外观分区，含一项偏好：聊天内容宽度。你可以选择标准、宽或超宽；更宽的档位覆盖 ui-conversation 的 `--dsh-chat-content-width` 轴（出厂默认 748px），而输入卡片宽度与居中 padding 都从同一变量派生，因此整条内容轴一致地加宽。该选择是持久偏好：跨重启、跨设置面板关闭都保留，并在浏览器保持打开期间持续生效。

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

在 web-app 模块表中挂载该插件行；当存在 settings provider 时，设置面板导航中出现 `appearance`（外观）条目，含一行偏好。选择某个档位立即生效并持久化。

### 宽度档位

标准档保持出厂的会话列宽（748px）。宽与超宽覆盖声明在会话根上的 `--dsh-chat-content-width` 自定义属性；输入卡片宽度与居中 padding 从同一变量派生，因此一次选择同时加宽整条内容轴。不高于标准的档位完全不注入覆盖。

### 持久化

该档位是本包设置命名空间（`ui-settings-appearance`，字段 `contentWidth`）中的持久偏好。Node 半在存在 settings provider 时注册该字段；浏览器半经 `ctx.settingsScope` 绑定它。选择某个档位会把它发布到一个插件生命周期的 store——设置面板关闭时会卸载各分区组件，因此行状态必须比任何单次渲染活得久——并把字段写回。外部文档变更（另一个浏览器、直接编辑）经共享 describe 镜像折回，使行与宽度样式表同时收敛。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

宽度变量的覆盖样式表归插件所有，而非分区组件：关闭设置从不重置列宽，样式表比行的任何单次渲染活得久。Node 半声明命名空间与字段，使该偏好存在于 Host 文档中；浏览器半绑定 scope、渲染行，并把活动档位发布到拥有覆盖注入的 store。

| 文件 | 职责 |
|---|---|
| [`src/appearance-settings.ts`](src/appearance-settings.ts) | 命名空间、字段名与 settings 类型 |
| [`src/client/index.ts`](src/client/index.ts) | 插件主体：scope 绑定、store 声明、行注册 |
| [`src/client/core.ts`](src/client/core.ts) | 档位到 CSS 的纯映射（宽度覆盖） |
| [`src/client/AppearanceSection.tsx`](src/client/AppearanceSection.tsx) | 设置行及其档位控件 |
| [`src/client/locales.ts`](src/client/locales.ts) | `settings.appearance` locale 命名空间内的分区文案 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [ui-settings](../ui-settings/README.zh.md) — 承载本分区的设置面板外壳。
- [Web 样式参考](../../../docs/web-styling.zh.md) — 覆盖所遵循的 token 与 CSS Module 规则。
- [客户端包地图](../README.zh.md) — 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为宽度档位是纯展示：它只在一个浏览器中覆盖 `--dsh-chat-content-width`，不触碰任何会话事件、draft 内容或请求载荷。

#### KV Cache 影响

无；消息前缀（system + history）在各档位间逐字节相同，prefix caching 不受影响。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>


这些限制界定当前外观面。它们是包约束，不是通用主题系统对比或任务清单。

- **单一宽度轴** — 覆盖只针对 `--dsh-chat-content-width`；轨迹视图、详情列与其他产品面保持各自的宽度。
- **回环持久化** — settings RPC 仅回环可用，因此远程浏览器以内存模式运行 scope：页签与控件可用，但那里的选择不会持久化到 Host 文档（这是所有 settings 支撑偏好的共同限制）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
