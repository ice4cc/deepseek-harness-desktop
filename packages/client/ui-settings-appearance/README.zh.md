# @deepseek-ai/dsh-client-ui-settings-appearance

[English](README.md) | 中文

外观设置页签：在设置面板导航中注册一个 `appearance`（外观）条目，内含一行偏好——聊天内容宽度，共三档（标准 / 宽 / 超宽）。标准档保持产品自带的对话列宽度；更宽的档位覆盖 ui-conversation 的 `--dsh-chat-content-width` 轴，输入卡片宽度与居中 padding 都从该变量派生，因此整条内容轴一致加宽。

## 机制

宽度档位是持久化偏好，存于本包的设置命名空间（`ui-settings-appearance`，字段 `contentWidth`）：Node 半在存在 settings provider 时注册该节，浏览器半通过 `ctx.settingsScope` 绑定。选择档位时先发布到插件生命周期的 store（设置面板关闭时会卸载各页签组件，行状态必须比任何一次渲染活得久），再写回字段。宽度变量的覆盖样式表归插件所有，而非页签组件：关闭设置不会重置列宽，标准档及以下不注入任何样式。外部文档变更（其他浏览器、直接编辑）经共享 describe 镜像折回，行与样式表同时收敛。

## Model Experience

### 无模型可见变化

#### 模型看到什么

宽度档位是纯展示层：只改变一个浏览器里对话列的渲染宽度。不影响任何 session 事件、草稿内容或请求载荷，所有模型请求与之前完全一致地渲染。

#### Token 影响

无。各档位下 prompt 大小不变。

#### KV Cache 影响

无。消息前缀（system + history）在各档位下逐字节相同，前缀缓存不受影响。

## Known Limitations and Deferred Work

- **只有一条宽度轴** — 覆盖仅针对 `--dsh-chat-content-width`；trajectory 视图、details 列等其他产品表面保持各自宽度。
- **仅回环持久化** — settings RPC 仅限回环，远程浏览器以内存模式运行 scope：页签与控件可用，但在那边的选择不会持久化到 Host 文档（这是所有设置类偏好的共同限制）。
