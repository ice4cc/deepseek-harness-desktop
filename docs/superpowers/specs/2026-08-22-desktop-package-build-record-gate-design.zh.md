# 桌面打包：构建记录新鲜度门禁

[English](2026-08-22-desktop-package-build-record-gate-design.md) | 中文

## 摘要

`apps/desktop/scripts/package.mjs` 目前以两个文件存在性检查（`apps/cli/lib/bin.js` 和 `apps/web/dist/index.html`）作为打包门禁。该门禁对实际咬过桌面 app 的两种失败模式是盲的：陈旧的 `apps/web/dist`（白屏、`ModuleLoader` 双重启动）和不完整的客户端构建（`lib/client.js` 缺失或未用选定的客户端 profile 构建）。本变更将该弱门禁替换为一个硬门禁，复用仓库现有的 `readClientBuildRecord()` 校验器，它把完整工件摘要（`apps/web/dist/**` 加上每个 `packages/*/*/lib/client.js`）绑定到记录的公开客户端环境。

## 问题

`scripts/build.ts`（根 `pnpm run build`）已经在做正确的事：它用选定的客户端环境运行 `build:lib`（tsc + tsdown host/client face）和 `build:web`（vite），然后写入包含所有客户端工件 SHA-256 摘要的 `.dsh-build/client-build-environment.json`。`readClientBuildRecord()`（位于 `scripts/client-build-environment.ts`）读取该记录，并在当前工件不再匹配记录的摘要时 throw。

但桌面打包路径从未通过 `build.ts` 调用根构建 — 手工调试流程逐个 face 手工运行 `vite build` 和 `tsdown`，因此从未写入记录，而打包门禁（两个 `existsSync` 检查）静默放行了陈旧或不完整的工件。 任何手工构建的人都会重蹈同样的缺口。

## 决策

**硬门禁，复用现有记录校验器。** 在暂存部署之前，`package.mjs` 运行 `readClientBuildRecord(repoRoot)`，若其 throw 则中止打包（退出码 1）— 即记录缺失或磁盘工件 不再匹配记录的摘要。两个文件存在性检查保留为快速、友好的预检（在记录检查运行之前给出清晰错误）。

### 为何硬门禁 + 摘要，而非替代方案

- **硬，非软。** 仅警告的门禁保留当前失败模式原样（打包成功、app 是坏的）。目标是打包前失败， 因此缺失或陈旧的记录必须停止构建。
- **摘要，非 mtime。** 基于 mtime 的新鲜度检查在 CI、拷贝和 `pnpm deploy`（它会重写 mtime）之间 不可靠。内容摘要是精确的，且已是发布流程信任的机制（`scripts/release/families.ts:328` 调用 `readClientBuildRecord(root, officialClientBuildEnvironment(root))`）。
- **复用，非新校验器。** `readClientBuildRecord` 已对完整工件集计算摘要。在打包脚本中重新实现它 会使“完整客户端构建”的定义分叉并漂移。

### 本变更后的正确打包流程

1. `pnpm run build`（本地 profile）或 `pnpm run build:official`（官方品牌）— 这一步写入记录。
2. `node apps/desktop/scripts/package.mjs [--mac|--win|--linux]`。

手工构建客户端工件（直接运行 `vite build` / `tsdown` face）不产生记录，因此打包以清晰消息失败。 这是有意为之：它消除了“我以为我构建过”这一失败类别。

## 组件

### 1. `apps/desktop/scripts/verify-build-record.mts`（新建）

一个小的入口，由打包脚本经 `node --import tsx` 调用（仓库既有的 `.mjs` → `.ts` 模式，见 `scripts/demo-cordis.mjs:9`）。它：

- 解析仓库根（从 `apps/desktop/scripts` 上溯两级）。
- 从 `<root>/scripts/client-build-environment.ts` `import` `readClientBuildRecord`。
- 调用 `readClientBuildRecord(root)`。
- 成功时：打印一行确认并以退出码 0 结束。
- throw 时：打印错误消息加修复提示（`run \`pnpm run build\` from the repository root` — 官方品牌为 `pnpm run build:official`）并以退出码 1 结束。

保持为独立文件（而非内联的 `node -e` 字符串），以便可单元测试且可读。约 25 行。

### 2. `apps/desktop/scripts/package.mjs`（修改）

取代两个工件存在性循环作为*唯一*门禁的角色：

- 保留两个 `existsSync` 检查（快速、友好）。
- 紧随其后添加对 `verify-build-record.mts` 的调用，经 `node --import tsx <abs path to the .mts>`。非零退出 → `console.error` 带捕获的原因并 `process.exit(1)`。
- 更新模块头部文档（步骤 1）以描述记录门禁。

`tsx` 二进制从仓库根 `node_modules/.bin` 解析（desktop 包不依赖 tsx；它是根 devDependency，且打包脚本 本就运行自仓库 checkout）。

### 3. `apps/desktop/tests/verify-build-record.spec.ts`（新建）

针对门禁行为的 Vitest 单元测试，用临时目录作为假仓库根，使测试不依赖真实的 `.dsh-build` 记录：

- **通过**：摘要与假工件匹配的有效记录 → 退出码 0 / 不 throw。
- **记录缺失**：无 `.dsh-build/client-build-environment.json` → 以“run pnpm run build”修复提示 throw。
- **工件陈旧**：写入记录后，某个工件的字节变化 → 摘要不匹配 → throw。

测试通过真实构建使用的同一个 `writeClientBuildRecord` 辅助函数构造记录，因此走的是真实摘要路径而非 手工拼装的 fixture。

## 错误处理

- 记录缺失 → `readClientBuildRecord` throw `client build record ... is missing; run a complete pnpm run build first`。门禁将其连同 `build:official` 变体提示一并呈现。
- 摘要不匹配 → `client artifacts differ from ...; run a complete pnpm run build before consuming them`。
- 两者都映射为在任何 `rmSync(out)` 或部署工作发生之前退出码 1，因此失败的门禁让上一个 `out/` 和已安装的 app 保持原样。

## 涉及文件

- `apps/desktop/scripts/package.mjs` — 门禁 + 头部文档。
- `apps/desktop/scripts/verify-build-record.mts` — 新入口。
- `apps/desktop/tests/verify-build-record.spec.ts` — 新测试。
- Agent Note（proposed/ → implemented/）— 类别 `process`（工具/门禁，非运行时行为）；按 `dsh-agent-notes` 格式要求英文 + 中文 + sidecar。
- `apps/desktop/README.md` / `README.zh.md` — 记录新的打包前置条件 （`package.mjs` 之前先 `pnpm run build`）。

## 范围外

- 不改 `scripts/build.ts`、`scripts/client-build-environment.ts` 或记录格式 — 机制本身是正确的； 只是没有接入打包。
- 不做基于 mtime 的检查。
- 不在 `apps/desktop/package.json` 新增依赖（tsx 复用自仓库根）。

## 验证

- `pnpm run test` 覆盖新的单元测试。
- 手工：不经根 `build.ts` 手工构建（无记录）→ `package.mjs` 以清晰消息失败。然后 `pnpm run build` → `package.mjs` 继续。
- 现有 `pnpm run build:official` 流程仍产生门禁接受的记录。
