---
description: "会话投影单元：把成功的 edit/write 工具结果聚合成有界的按路径变更清单并内联 diff；面向 fileChanges 投影的消费者（如 Web 文档面板）。"
kind: "package-reference"
---

# @deepseek-ai/dsh-file-changes

[English](README.md) | 中文

## 概述

本包为每个会话提供一个 `fileChanges` 投影：把成功的 `edit`/`write` 工具结果按路径聚合成有界的变更清单——编辑次数、增删行合计、最近改动时间与最近一次改动的 hunk。文档面板「变更」页签这样的消费者读取一个值，即得到本会话完整的文件变更故事与内联 diff，无需扫描事件日志。投影经 session-projection 缝对外提供（registry 快照、变更流，以及每一个 projection 载体），因此 agent 工作时实时更新，且能从日志确定性回放。

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

在已提供 `sessionProjections` 的装配中挂载该插件；它注册 `fileChanges` key，消费者经投影缝读取。

### 挂载

```yaml
- id: file-changes
  name: '@deepseek-ai/dsh-file-changes'
```

插件注入 `sessionProjections`——它的全部目的；在没有 registry 的装配中 fiber 保持 pending，什么都不注册。

### 折叠什么

- 只有成功的 `edit`/`write` 结果参与折叠：call 在 `tool/call` 时按 callId 暂存其 `file_path`（`write` 还有原始 `content`），配对的 `tool/result` 将其折叠。出错的结果、其他工具、畸形参数与未配对的结果不改变任何状态。
- `added`/`removed` 把每个 hunk 的变更行计为其新旧两侧的上下文抵消多重集差（上下文行两侧都出现而抵消）；旧侧为 `null` 时其新行计为新增。行终止符规则与 diff 面一致：空文本为零行，单个尾部换行是终止而非新增。
- `lastDiff` 只保留最近一次改动的 hunk；`edits`、`added`、`removed` 跨该路径所有被折叠的改动累积。
- 有界性是契约的一部分：至多 32 个路径（按触碰顺序 LRU 逐出）、每个保留 diff 至多 40 个 hunk、每个 hunk 侧截断到 8,000 字符并带标记。截断只在展示侧——计数仍覆盖所有 hunk。
- 结果从未落地的 call 属于被取消或失败的 turn；暂存的 call 在 `turn/end` 丢弃（结果都在其 turn 内落地）。
- 路径按模型书写原样记录（model-facing、未解析）；相对会话 cwd 的化简是消费者的职责，经任何其他面（bash、手工编辑）做出的改动按设计对该投影不可见。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

插件向 session-projection registry 注册一个投影单元：以路径为键的状态机，经 `apply(state, event)` 在会话日志上更新。由于每次更新都是已记录事件的纯折叠，同一状态既可由实时流导出，也可由回放导出。client 面（`/client`）为运行在浏览器中的消费者暴露带类型的读模型。

| 文件 | 职责 |
|---|---|
| [`src/projection.ts`](src/projection.ts) | `fileChanges` 投影定义：schema、折叠、wire 视图 |
| [`src/types.ts`](src/types.ts) | 投影状态与视图类型、registry 合并 |
| [`src/client.ts`](src/client.ts) | 浏览器侧带类型的读模型 |

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [ui-doc-panel](../../client/ui-doc-panel/README.zh.md) — 参考消费者：带内联 diff 的「变更」页签。
- [session-projection](../session-projection/README.zh.md) — 提供本 key 及其他所有投影的缝。
- [会话子系统页](../../../docs/subsystems/session.zh.md) — 折叠所消费的事件词汇。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该插件只计算已落日志会话事件的客户端读模型，不触碰任何 prompt、消息、schema、流或工具结果。

#### KV Cache 影响

无；该插件从不组装或发送 provider 请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>


这些限制界定当前投影面。它们是包约束，不是通用 diff 引擎对比或任务清单。

- **按工具名限定** — 折叠匹配名为 `edit`/`write` 的工具，本 harness 中它们由 dsh-tool-fs 拥有；复用这两个名字但形状不同的工具会按其自身参数字段折叠（缺 `file_path` 只是不暂存）。
- **无结果元数据的编辑不留 diff** — 该改动的 `lastDiff` 保持 null（计数仍累积），因为已应用的 hunk 无法仅从日志重建。
- **只挂载在 web-app bundle** — 其他装配不提供 `fileChanges` key；消费者把值缺席读作「无变更」而非错误。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
