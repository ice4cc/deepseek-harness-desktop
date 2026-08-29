# @deepseek-ai/dsh-file-changes

[English](README.md) | 中文

注册 `fileChanges` projection 单元的函数插件：把成功的 `edit`/`write` 工具结果按路径聚合成有界的变更清单——编辑次数、增删行合计、最近改动时间与最近一次改动的 hunk——从 `tool/call`/`tool/result` 配对折叠而来，经 session-projection 缝对外提供（registry 快照、变更流，以及每一个 projection 载体）。参考消费者是 Web 文档面板的「变更」页签，它列出本会话的文件改动并内联展示 diff。

## 折叠语义

- 只有成功的 `edit`/`write` 结果参与：调用在 `tool/call` 时按 callId 记下 `file_path`（`write` 还记原始 `content`），配对的 `tool/result` 将其折入。错误结果、其他工具、参数畸形与未配对的结果一律不改变状态。
- `added`/`removed` 按每个 hunk 新旧两侧的「上下文抵消多重集差」统计改动行（上下文行两侧都有，相互抵消）；`oldText` 为 null 时其新行全部计为新增。换行规则与 diff 展示面一致：空文本为零行，单个尾随换行是终止符而非多出一行。
- `lastDiff` 只保留最近一次改动的 hunk；`edits`、`added`、`removed` 对该路径的全部折叠改动累加。
- 有界性是契约的一部分：至多 32 个路径（按触碰顺序 LRU 淘汰）、每个保留 diff 至多 40 个 hunk、每侧文本截断到 8,000 字符并带标记。截断只影响展示——计数仍覆盖全部 hunk。
- 结果始终未落地的调用属于被取消或失败的轮；挂起的调用在 `turn/end` 时丢弃（结果总在其轮内落地）。
- 路径按模型写入的原样记录（面向模型、未解析）；相对会话 cwd 的相对化由消费者负责，而经其他途径（bash、手工编辑）做出的改动按设计对本 projection 不可见。

## 组合

```yaml
- id: file-changes
  name: '@deepseek-ai/dsh-file-changes'
```

注入 `sessionProjections`——这是插件的全部用途；在没有 registry 的装配中 fiber 保持挂起，不注册任何内容。

## 模型体验

无，因为插件只计算面向客户端的、由已写入日志的会话事件派生的读模型，不触碰任何提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；插件从不组装或发送提供方请求。

## 已知局限与延后工作

- **按工具名圈定**——折叠匹配名为 `edit`/`write` 的工具，在本 harness 中由 dsh-tool-fs 拥有；复用这两个名字的其他形状工具会按其自身参数字段折叠（缺 `file_path` 时只是不挂起任何内容）。
- **缺少结果元数据的 edit 不留 diff**——该次改动的 `lastDiff` 保持 null（计数照常累加），因为应用的 hunk 无法仅凭日志重建。
- **仅挂载于 web-app bundle**——其他装配不提供 `fileChanges` 键；消费者把值的缺失读作「无改动」，而非错误。
