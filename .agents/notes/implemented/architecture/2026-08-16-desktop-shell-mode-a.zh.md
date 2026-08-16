# Agent Note: 桌面壳以 dsh web profile 的 Electron 封装形式交付

Status: implemented

[English](2026-08-16-desktop-shell-mode-a.md) | 中文

## 问题

产品需要一个桌面客户端，且有两个相互拉扯的要求：深度定制的 UI，以及能持续同步官方主线、让新功能无需返工地到达。独立的原生 GUI 会为 web 客户端已经渲染的每一个工具、消息和插槽拥有第二套渲染面——此后上游对客户端的每一处改动都需要人工移植，两个界面会不断漂移。仓库此前没有任何桌面分发形式。

## 决策

`apps/desktop`（@deepseek-ai/dsh-desktop）是一个 Electron 壳：它以子 Node 进程方式拉起 `dsh` web profile（`web --port 0`，通过 Electron 自带二进制加 `ELECTRON_RUN_AS_NODE=1` 运行），等待文档约定的就绪行（`dsh web: http://127.0.0.1:<port>`），然后在单个 BrowserWindow 中加载该回环地址。壳不增加任何协议面：页面与 dsh 之间走同源 HTTP/WebSocket，与浏览器中完全一致，因此所有 web 客户端包和全部基于插槽的 UI 定制原样工作，上游主线同步无需任何客户端侧移植即可落入桌面应用。

两种启动布局共用一个 `resolveInstall()`：dev 布局通过 tsx 启动源码树（`node --expose-internals --import <tsx> apps/cli/src/bin.ts web --port 0` 加 `TSX_TSCONFIG_PATH`），因为 pnpm 隔离的 checkout 无法向 plain Node 提供裸 `@deepseek-ai/*` 包名；打包布局在 plain Node 下运行 `resources/dsh/lib/bin.js`。打包载荷是 `@deepseek-ai/dsh` 的 `pnpm deploy --legacy --prod`，由 `scripts/package.mjs` 修复：仅 peer 声明的包在部署期间被注入，store-only 包获得相对顶层符号链接（profile boot 的字面路径 node_modules 遍历无法穿透 pnpm 虚拟目录），工作区的 `link:vendor/*` 覆盖被实体化进 store（deploy 会把它们保留为指回源码 checkout 的链接），所有不能解析到部署内部的符号链接被剪除（electron-builder 对每个拷贝文件做 stat，遇到断链即失败）。

生命周期：显式的 `app.setName('DeepSeek Harness Desktop')` 使单实例锁和 userData 与其他共享同一工作区包名的构建保持区分；关闭窗口终止子进程（SIGTERM，5 秒后 SIGKILL）并在所有平台退出；`$DSH_HOME/desktop/` 下的 pidfile 回收被强杀实例遗留的子进程，只杀死命令行仍指向 dsh 入口的 pid。

## 备选方案

- **Electron 内进程内宿主**（把 dsh boot 图作为应用自身模块图加载，用自定义协议提供资源）：否决——它把 web 客户端的渲染与解析路径从浏览器服务的路径中分叉出去；上游每处客户端改动都要在两个运行时中验证，且 Node 内部加载器需求使宿主侧在 Electron 二进制下永久特判。
- **独立原生 UI**（Electron/React-native 自绘工具与消息）：否决——为 web 客户端已渲染的一切拥有第二套界面，正是同步要求所排除的漂移成本。
- **直接打包源码 checkout**（捆绑仓库、从中运行）：否决——pnpm 隔离 store 在工作区之外无法被 plain Node 解析；deploy 加修复流水线是能以与 dev 完全一致的方式启动（同一 38 项 boot 图）的最小自包含布局。

## 后果

- 桌面 GUI *就是* web 应用：深度 UI 定制走既有的客户端插件与插槽接缝（Phase 2），而非平行代码库；上游同步只触及三个上游文件（`pnpm-workspace.yaml` allowBuilds、`tsconfig.base.json` 中 picker 包的两个 paths 条目——本工作暴露的上游缺口——以及根 `package.json` 脚本），全部列于 `apps/desktop/README.md`。
- dsh 子进程运行在 Electron 自带 Node 上；Electron 升级必须使其保持在仓库 `engines` 范围内。
- pnpm deploy 不是 plain-Node 运行时布局，因此打包携带四个修复步骤；它们是确定性的，并通过从中立目录启动部署树来验证。
- 延期项：托盘、全局快捷键、原生目录选择器后端（picker 接缝已为 Electron 提供的 `native` 后端预留）、Windows 残留子进程回收（该平台上没有 `ps`）。
