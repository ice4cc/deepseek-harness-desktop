# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

dsh web GUI 之上的 Electron 桌面壳（Mode A：回环 HTTP）。主进程以子 Node 进程方式拉起 `dsh` web profile（`web --port 0 --no-open`——GUI 就在应用自己的窗口里，无需交给系统浏览器；通过 Electron 自带二进制加 `ELECTRON_RUN_AS_NODE=1` 运行），等待文档约定的就绪行（`dsh web: http://127.0.0.1:<port>`），然后在单个 BrowserWindow 中加载该回环地址。GUI 由绑定到 127.0.0.1 的 `dsh-host-webserver` 服务；壳不增加任何协议面——页面与 dsh 之间走同源 HTTP/WebSocket，与浏览器中完全一致，因此所有 web 客户端包（以及全部基于插槽的 UI 定制）原样工作。

## 从源码运行

```sh
pnpm run build                                  # builds apps/cli lib + frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run dev  # electron . over the repo checkout
```

dev 布局通过 tsx **从源码**启动 dsh bin（`node --expose-internals --import <tsx> <repo>/apps/cli/src/bin.ts web --port 0 --no-open`，加 `TSX_TSCONFIG_PATH=<repo>/tsconfig.json`）：pnpm 隔离的 checkout 无法向 plain Node 提供仓库裸 `@deepseek-ai/*` 包名，所以源码启动走 tsx 的 tsconfig-paths 解析——与无密钥 web smoke 使用同一契约。完整环境会被透传，因此 `DEEPSEEK_API_KEY`（或已配置的 provider）能到达宿主。

cordis HMR 服务需要 `--expose-internals`：它依赖 Node 的内部 ESM 加载器，而在 Electron 自带 Node（RUN_AS_NODE 模式）下，plain 源码启动所依赖的 `node-addon-require-builtin` 回退不保证能加载。

## 生命周期语义

- 单实例锁：第二次启动会聚焦已有窗口并退出，不触碰正在运行的子进程。
- 关闭窗口终止子进程（SIGTERM，5 秒后 SIGKILL）并在所有平台退出——这是有意为之，确保关闭应用绝不会让 agent 宿主无人看管地继续运行。
- 子进程提前退出时弹出带 stderr 尾部的对话框并退出。
- `$DSH_HOME/desktop/dsh-child.pid` 下的 pidfile 回收被强杀的上一个实例遗留的 dsh 子进程；只有当该 pid 的命令行仍指向 dev 源码入口（`apps/cli/src/bin.ts`）或打包 bin（`dsh/lib/bin.js`）时才会被杀死。

## 窗口一体化

macOS 与 Windows 都隐藏系统标题栏，让页面自绘的顶部条带承载窗口：macOS 将红绿灯内嵌（`titleBarStyle: 'hiddenInset'`），Windows 只把原生最小化/最大化/关闭按钮浮在同一条 44 px 条带上（`titleBarStyle: 'hidden'` + `titleBarOverlay`）；Linux 保留原生窗口框与菜单栏。两个无边框平台都开启 `acceptFirstMouse`——点击未聚焦窗口直接生效而非仅激活（浮动展开按钮需要它）。Windows 去掉默认的内嵌菜单栏（`Menu.setApplicationMenu(null)`；macOS 保留屏幕顶部的系统菜单栏）——它所携带的快捷键（刷新、缩放、devtools）不属于产品面，源码启动保留 F12 作为窗口级 devtools 入口。Windows 覆盖层是实色的（WCO 不支持透明），因此初始取深色窗口表面，随后跟随页面解析出的主题：沙箱 preload（`src/preload.cjs`）暴露 `window.dshDesktop.setThemeColors`，web 入口的 desktop 分支在加载时以及主题重写 body 时上报计算后的 body 背景/文字色。壳在加载 URL 上追加 `?shell=desktop`，`apps/web/src/main.ts` 据此给 `<html>` 打上 `data-shell="desktop"` 标记。以该属性为键的桌面专属布局规则（追加块与少量插入，位于 `ui-sidebar` SidebarRoot、`ui-layout` AppFrame、`ui-conversation` ConversationRoot 与模态层——`ui-settings-general` SettingsRoot 和 `ui-primitives` Modal/OnboardingSurface）：

- **红绿灯让位**——侧栏品牌行变为两行：第一行是钉在红绿灯高度的折叠/展开按钮，下方是全宽字标。
- **零宽折叠**——收起的侧栏取零宽而非默认的 56 px 窄栏；其竖排菜单项被隐藏。纯浏览器保留带边框窄栏。
- **常驻浮动按钮**——同一个按钮经 portal 渲染进框架的 overlay 层，两种状态位于同一坐标。零宽列中 fixed 定位的逃逸元素无法被可靠地裁出浏览器进程缓存的拖拽区域（真实点击落在会话条带的 drag 区上：单击拖动窗口、双击缩放）；portal 到无裁剪的全视口层恢复了可靠的命中测试，而单一常驻节点意味着折叠/展开不交换任何 DOM。
- **窗口拖拽区**——会话列顶部条带可拖动窗口（空态 hero 面板，或打开会话后的会话头行），侧栏品牌行同样可拖；其内部可交互元素保持 no-drag。只要点击落在某个没有任何显式 no-drag 元素裁出的缓存 drag 矩形内，Chromium 就会把该点击路由给窗口，而另一棵树的元素（portal 到 `document.body` 的菜单列表、模态层）无法裁出条带自己的矩形。全屏模态层在打开期间对整个层声明 `no-drag`——居中面板与头部条带的矩形重叠（会话头行包含标签栏，其盒子向下延伸到约 68 px——正好盖住面板的关闭按钮和头部操作区）。小型 portal 菜单无法罩住其条带：只要有任意 portal 菜单打开，`ui-primitives` Menu 就给 `<html>` 打上 `data-portal-menu-open` 标记（带引用计数），所有 drag 条带在标记存续期间让位 `no-drag`——否则模式菜单中垂在 hero 输入卡片下方的行会把每次点击都吞进窗口，而不是选中对应模式。

纯浏览器加载不带该标记、维持原有布局（`-webkit-app-region` 在 Electron 之外无效果）。首帧前的 `backgroundColor` 取深色基底 token；窗口表面的主题跟随为延期项。

## 打包布局（electron-builder）

`resources/dsh/` 携带一份自包含的 `@deepseek-ai/dsh` 生产安装：一个 `pnpm deploy --legacy --prod` 闭包，加上 `scripts/package.mjs` 应用的后续处理步骤——因为 pnpm 隔离 store 不能被 plain-Node 运行时解析，且不得引用源码 checkout：

1. **仅 peer 声明注入**——闭包中只作为 `peerDependencies` 被引用的包对 pnpm deploy 闭包不可见（能力 Service Definition 等接缝），因此它们在部署期间被加入部署目标的 `dependencies`，之后恢复原 manifest。
2. **顶层扁平化**——为 store 保留在 `.pnpm` 虚拟目录中的每个包在根 `node_modules` 添加一个相对符号链接。dsh profile boot 从安装锚点出发做字面路径的 node_modules 遍历来解析插件导入，无法穿透顶层符号链接进入 store；扁平布局使闭包内每个包都能从任意锚点解析。
3. **link 覆盖实体化**——工作区的 `link:vendor/*` 覆盖（重定范围的 Cordis 基础）被拷贝进 store，且树内所有指向它们的链接被重定向，因为 pnpm deploy 会把那些覆盖保留为指回源码 checkout 的链接。
4. **外部链接剪除**——任何不能解析到部署内部的符号链接都被移除；electron-builder 对它拷贝的每个文件做 stat，遇到断链即失败。

主进程在 `app.isPackaged` 时把 bin 解析为 `resources/dsh/lib/bin.js`（plain Node 启动——无需 tsx）。见本包 `package.json` 的 `package` 脚本。

**进程名。** 打包后的主可执行文件在 macOS 与 Windows 上都叫 `chrome`，两个平台的进程列表读起来一致（dsh 子进程通过同一二进制运行，因此同名）。macOS 上 electron-builder 的顶层 `executableName` 同时决定 `.app` 捆绑包名和主可执行文件，因此单独写 `executableName: chrome` 也会把捆绑包打成 `chrome.app`；改为让捆绑包保留 `productName`（`DeepSeek Harness.app`），由 `scripts/package.mjs` 通过 JS API 驱动 electron-builder，并用 `afterPack` 钩子仅把主可执行文件改名为 `chrome`（同时把 `CFBundleExecutable` 指向它），*在* 代码签名封存状态之前完成。Windows 在 `electron-builder.yml` 的 `win.executableName` 上以平台作用域写同一个名字，那里它只决定 exe 名（`chrome.exe`）。于是活动监视器/任务管理器显示 `chrome`，而 Finder、Dock 和关于框——以及 Windows 的开始菜单项与卸载显示名——保留 `DeepSeek Harness`。dev 构建在两个平台上都以 `Electron` 运行。

从 shell 验证打包构建前，先 unset `ELECTRON_RUN_AS_NODE`：该变量存在时，应用二进制会以 plain Node 方式运行并静默退出，不会启动 GUI。

## 应用图标

`assets/app-icon/mark.svg` 是 DeepSeek 标志（LobeHub 图标集，MIT）。`scripts/generate-icons.mjs` 把它渲染成 electron-builder 的构建资源（`build/`）：`icon.icns`（1024 画布上的 824×824 圆角方砖，Big Sur 图标网格）、`icon.ico`（全幅方形，16–256 的 PNG 条目）和 `icon.png`（512 方形，Linux）——各变体均为应用深色底（#151517）上的白色标志。用 `pnpm --filter @deepseek-ai/dsh-desktop run icons` 重新生成；`icns` 步骤需要 macOS（`iconutil`），因此生成产物已提交，跨平台打包无需重新构建。

## 上游同步

`upstream` remote 跟踪 `deepseek-ai/deepseek-harness`（默认分支 `master`）。用 `git fetch upstream && git merge upstream/master` 同步，然后跑验证阶梯：`pnpm run test:gui` → `DSH_SNAPSHOT=replay pnpm run test:web` → dev 模式启动本应用。

本应用是纯增量的（仅 `apps/desktop/`），因此合并只在本工作有意触及上游文件的地方冲突——保持该列表最小且机械：

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `pnpm-workspace.yaml` | `allowBuilds`: `electron: true`, `electron-winstaller: false` | pnpm 10+ 拦截未列出的构建脚本；需要 Electron 二进制下载，Windows NSIS 工具链在此为 no-op |
| `tsconfig.base.json` | `dsh-client-ui-directory-picker-{native,browse}` 的两个 `paths` 条目 | 这些客户端包缺少每个 host/client-group 包都需要的显式条目（上游 bug；缺它源码启动在 Node 24 上失败） |
| 根 `package.json` | `desktop:dev`、`desktop:package` 脚本 | 便捷入口 |
| `apps/web/src/main.ts` | `?shell=desktop` 标记检测（给 `<html>` 打 `data-shell="desktop"`）+ 向壳 preload 上报解析后的主题色 | 窗口一体化——见上节 |
| `packages/client/ui-layout/.../AppFrame.tsx` + `.module.css` | desktop 下收起侧栏的零宽轨道；收起时无边框缝 | 窗口一体化——见上节 |
| `packages/client/ui-sidebar/.../SidebarRoot.tsx` + `.module.css` | 常驻 portal 按钮、两行品牌行、收起时隐藏菜单项；品牌行在 `<html data-portal-menu-open>` 存续期间让位 `no-drag` | 窗口一体化——见上节 |
| `packages/client/ui-sidebar/package.json` | portal 导入所需的 `react-dom` 依赖（+ `@types/react-dom`） | 窗口一体化——见上节 |
| `packages/client/ui-conversation/.../ConversationRoot.module.css` | 追加的 `data-shell` 键控块（hero + 会话头拖拽区）；拖拽区在 `<html data-portal-menu-open>` 存续期间让位 `no-drag` | 窗口一体化——见上节 |
| `packages/client/ui-settings-general/.../SettingsRoot.module.css` | 设置面板层打开期间整体 `no-drag`（拖拽区裁出） | 窗口一体化——见上节 |
| `packages/client/ui-primitives/.../Modal.module.css`、`OnboardingSurface.module.css` | 模态 + 首次运行舞台层打开期间整体 `no-drag`（同一裁出） | 窗口一体化——见上节 |
| `packages/client/ui-primitives/src/Menu.tsx` + `tests/atoms.client.spec.tsx` | 打开的 portal 菜单在其存续期间给 `<html>` 打 `data-portal-menu-open` 标记（带引用计数），即拖拽区让位信号 | 窗口一体化——见上节 |

若上游自行加入了相同的 `paths` 条目或脚本，合并时丢弃本地副本。web 侧补丁是追加块与数行插入；合并冲突时保留本地版本，除非上游发布了它自己的桌面壳布局。

## 已知限制与延期工作

- Windows 标题栏覆盖层是实色的，仅在渲染端首次上报后才跟随页面主题；在此之前（以及页面从未加载时）显示深色窗口表面。
- 尚无托盘、全局快捷键、原生目录选择器后端——它们是 Phase 2+ 的界面（picker 接缝已为 Electron 提供的 `native` 后端预留）。
- 子进程运行在 Electron 自带的 Node 上；未来的 Electron 升级必须使其保持在仓库 `engines` 范围内（`^22.19 || >=24`）。
- Windows 残留子进程回收依赖 `ps`，该平台没有此命令；pidfile 仍会写入和移除，但在平台检查落地前回收是 no-op。
