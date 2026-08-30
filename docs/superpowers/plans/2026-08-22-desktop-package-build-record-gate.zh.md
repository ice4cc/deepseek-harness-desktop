# 桌面打包构建记录门禁 — 实施计划

[English](2026-08-22-desktop-package-build-record-gate.md) | 中文

> **给智能体工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实施本计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 让 `apps/desktop/scripts/package.mjs` 在仓库的客户端构建记录（`.dsh-build/client-build-environment.json`）不存在、或其工件摘要与磁盘上的工件不匹配时拒绝打包，使陈旧的 `apps/web/dist` 或缺失/不完整的客户端构建在打包前失败，而不是产出一个坏掉的 app。

**架构：** 新增一个小的 `verify-build-record.mts` 入口，从 `scripts/client-build-environment.ts` 导入 `readClientBuildRecord`，任何 throw 都以非零退出。`package.mjs` 通过 `node --import tsx`（仓库既有的 `.mjs`→`.ts` 模式，见 `scripts/demo-cordis.mjs:9`）在现有文件存在性预检之后立即调用它，失败时中止打包。单元测试针对临时目录中的假仓库根，使用真实的 `writeClientBuildRecord` 辅助函数覆盖通过 / 记录缺失 / 工件陈旧三条路径。

**技术栈：** Node（ESM）、`tsx`（根 devDependency）、vitest、`scripts/client-build-environment.ts` 中现有的 `readClientBuildRecord`/`writeClientBuildRecord`。

## 全局约束

- 全部使用 ESM（`"type": "module"`）；本地相对导入使用 `.ts` 扩展名（如 `import { x } from '../../../scripts/client-build-environment.ts'`）。
- `apps/desktop/package.json` 不得新增 `tsx` 依赖 — tsx 从仓库根 `node_modules/.bin` 解析。
- 门禁必须在 `rmSync(out)` / 部署之前运行，使失败时上一个 `out/` 和已安装的 app 保持原样。
- 错误文案必须提示用户运行 `pnpm run build`（官方品牌为 `pnpm run build:official`）。
- Agent Note 类别为 `process`（工具/门禁，非运行时行为）；按仓库的 `verify-agent-note-format` 门禁要求英文 + 中文 + sidecar。
- 测试位于 `apps/desktop/tests/**/*.spec.ts`（由根 `vitest.config.ts` 的 `testIncludes` 条目 `apps/*/tests/**/*.spec.ts` 匹配）。
- 只运行聚焦检查；`pnpm run test` 覆盖新套件。不要默认运行全仓库套件。

---

### 任务 1：`verify-build-record.mts` 入口 + 单元测试

**文件：**
- 新建：`apps/desktop/scripts/verify-build-record.mts`
- 测试：`apps/desktop/tests/verify-build-record.spec.ts`

**接口：**
- 消费：来自 `scripts/client-build-environment.ts` 的 `readClientBuildRecord(root: string, expected?: ...)` 和 `writeClientBuildRecord(root: string, environment: ClientBuildEnvironment)`。入口是一个薄的 `main()`，在仓库根上调用 `readClientBuildRecord`；测试导入导出的 `verify(repoRoot: string)` 函数（纯函数：失败时 throw，成功时返回 void），而不是进程级的 `main()`，因此不会 fork 子进程。
- 产出：
  - `verify(repoRoot: string): void` — 记录缺失或工件摘要不匹配时 throw（传播 `readClientBuildRecord` 的错误）；成功时返回 `undefined`。
  - `main(): void` — 解析仓库根（从 `apps/desktop/scripts` 上溯三级），调用 `verify`，成功时打印一行确认；出错时打印消息加修复提示并设置 `process.exitCode = 1`。
  - 直接运行时（`node --import tsx verify-build-record.mts`），调用 `main()`（由 `import.meta.main` 守卫）。

- [ ] **步骤 1：编写失败的测试**

创建 `apps/desktop/tests/verify-build-record.spec.ts`：

```ts ignore-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeClientBuildRecord } from '../../../scripts/client-build-environment.ts'
import { verify } from '../scripts/verify-build-record.mts'

// The digest covers apps/web/dist/** and packages/*/*/lib/client.js, so the
// fake repo root needs that exact layout for writeClientBuildRecord to find
// at least one artifact.
function seedArtifacts(root: string): void {
  const dist = join(root, 'apps', 'web', 'dist')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<!doctype html>\n')
  const clientPkg = join(root, 'packages', 'group', 'pkg')
  mkdirSync(join(clientPkg, 'lib'), { recursive: true })
  writeFileSync(join(clientPkg, 'lib', 'client.js'), 'module.exports = {}\n')
}

const LOCAL_ENVIRONMENT = { DSH_CLIENT_COMMIT_HASH: '0123456' }

describe('verify-build-record', () => {
  let root: string
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('passes when the record matches the current artifacts', () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-verify-record-'))
    seedArtifacts(root)
    writeClientBuildRecord(root, LOCAL_ENVIRONMENT)
    expect(() => verify(root)).not.toThrow()
  })

  it('fails with a build hint when the record is missing', () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-verify-record-'))
    seedArtifacts(root)
    expect(() => verify(root)).toThrow(/pnpm run build/)
  })

  it('fails when an artifact no longer matches the recorded digest', () => {
    root = mkdtempSync(join(tmpdir(), 'dsh-verify-record-'))
    seedArtifacts(root)
    writeClientBuildRecord(root, LOCAL_ENVIRONMENT)
    writeFileSync(join(root, 'apps', 'web', 'dist', 'index.html'), '<!-- stale -->\n')
    expect(() => verify(root)).toThrow(/artifacts differ|pnpm run build/)
  })
})
```

- [ ] **步骤 2：运行测试，确认其失败**

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && ./node_modules/.bin/vitest run apps/desktop/tests/verify-build-record.spec.ts` 预期：FAIL — `Cannot find module '../scripts/verify-build-record.mts'`（入口尚不存在）。

- [ ] **步骤 3：编写入口**

创建 `apps/desktop/scripts/verify-build-record.mts`：

```ts ignore-check
/**
 * Packaging gate: confirm the client build record still describes the on-disk
 * artifacts before the desktop app is packaged.
 *
 * The repository's root build (`pnpm run build` / `pnpm run build:official`,
 * scripts/build.ts) writes .dsh-build/client-build-environment.json binding a
 * digest of every client artifact (apps/web/dist/** and
 * packages/<group>/<pkg>/lib/client.js) to the public client environment. readClientBuildRecord
 * throws when that record is missing or the artifacts have moved on — exactly the
 * stale-dist and partial-client-build failures a hand-built tree silently ships.
 *
 * Invoked by package.mjs via `node --import tsx`; exits non-zero (and prints the
 * remediation) on any failure so packaging aborts before staging.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readClientBuildRecord } from '../../../scripts/client-build-environment.ts'

/**
 * Verify the client build record at the given repo root matches the current
 * artifacts.
 * @param repoRoot - repository root containing .dsh-build and the artifacts.
 * @returns undefined when the record is current.
 * @throws when the record is missing or its artifact digest no longer matches.
 */
export function verify(repoRoot: string): void {
  readClientBuildRecord(repoRoot)
}

/**
 * Resolve the repo root, verify, and surface a remediation on failure.
 * @returns void; sets process.exitCode to 1 on failure.
 */
export function main(): void {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')
  try {
    verify(repoRoot)
  } catch (error) {
    console.error(`build-record gate failed: ${error instanceof Error ? error.message : String(error)}`)
    console.error('run `pnpm run build` from the repository root first (or `pnpm run build:official` for the official brand)')
    process.exitCode = 1
    return
  }
  console.log('client build record verified (artifacts match .dsh-build/client-build-environment.json)')
}

if (import.meta.main) main()
```

注意：入口位于 `apps/desktop/scripts/`，因此仓库根在上溯**四**级（`scripts` → `desktop` → `apps` → 根是三级；但 `fileURLToPath(import.meta.url)` 是文件本身，所以 `..` 是 `scripts`、`..` 是 `desktop`、`..` 是 `apps`、`..` 是根 = 四个 `..`）。测试按相对路径导入该文件，不受此解析影响。

- [ ] **步骤 4：运行测试，确认其通过**

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && ./node_modules/.bin/vitest run apps/desktop/tests/verify-build-record.spec.ts` 预期：PASS（3 个测试）。

- [ ] **步骤 5：验证入口可独立运行且根解析正确**

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && node --import tsx apps/desktop/scripts/verify-build-record.mts; echo "exit=$?"` 预期：若记录存在，打印 verified 行且 `exit=0`；否则打印失败 + 提示且 `exit=1`。确认解析出的根是仓库根（错误消息应引用仓库上的 `.dsh-build/client-build-environment.json`，而非嵌套路径）。若路径不对，调整步骤 3 中 `..` 段的数量。

- [ ] **步骤 6：提交**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add apps/desktop/scripts/verify-build-record.mts apps/desktop/tests/verify-build-record.spec.ts
git commit -m "test(desktop): add build-record verification entrypoint and tests"
```

---

### 任务 2：将门禁接入 `package.mjs`

**文件：**
- 修改：`apps/desktop/scripts/package.mjs`（头部文档步骤 1，以及第 239-244 行的工件检查块）

**接口：**
- 消费：任务 1 的 `verify-build-record.mts`，通过 `node --import tsx <abs path>` 作为子进程调用。
- 产出：记录门禁失败时 `package.mjs` 以 `process.exit(1)` 中止（在 `rmSync(out)` 之前）；通过时照常继续。

- [ ] **步骤 1：更新头部文档**

在 `apps/desktop/scripts/package.mjs` 中，把模块 JSDoc 里的步骤 1 行（当前为 `* 1. Verifies the dsh build artifacts exist (...)`）改为：

```
 * 1. Verifies the dsh build artifacts exist and the client build record
 *    (.dsh-build/client-build-environment.json) still matches them via
 *    scripts/verify-build-record.mts — a stale apps/web/dist or a partial client
 *    build aborts here instead of shipping a broken app.
```

- [ ] **步骤 2：在工件预检之后添加记录门禁**

在 `package.mjs` 中，紧跟现有 `for (const artifact of [...])` 存在性循环（第 239-244 行）之后、`const platformFlag = ...`（第 248 行）之前，插入：

```js
// The file-existence check above is a fast pre-check only. The real gate is the
// client build record: a record written by `pnpm run build` binds a digest of
// every client artifact to the public client environment, so a stale apps/web/dist
// or a partial client build (missing lib/client.js, or a face built without the
// selected profile) is caught here, before any out/ staging. tsx is a root
// devDependency; the desktop package does not depend on it.
{
  const verifyScript = path.join(APP_DIR, 'scripts', 'verify-build-record.mts')
  const tsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
  try {
    execFileSync(process.execPath, ['--import', 'tsx', verifyScript], { stdio: 'inherit' })
  } catch {
    console.error('build-record gate failed; see the message above. Run `pnpm run build` from the repository root first.')
    process.exit(1)
  }
}
```

（无需导入 `tsx` — 打包调用从 checkout 内部运行，因此 `cwd` 继承自它，Node 会相对仓库根解析 `--import tsx`。带 `stdio: 'inherit'` 的 `execFileSync` 已流式转发子进程自己的错误/提示行。）

- [ ] **步骤 3：验证无记录时门禁中止打包**

先确认不存在记录（门禁的反向用例）：

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && ls .dsh-build/client-build-environment.json 2>/dev/null || echo "no record (good for this negative test)"`

然后运行打包脚本，确认它在部署之前、于门禁处停下：

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop/apps/desktop && node scripts/package.mjs --mac 2>&1 | grep -E "build-record gate|client build record|deploying" ; echo "exit=${PIPESTATUS[0]}"` 预期：打印 `build-record gate failed` 行（及子进程的提示），不打印 `deploying @deepseek-ai/dsh`，且 `exit=1`。

- [ ] **步骤 4：验证有记录时门禁通过、打包继续**

运行根构建生成一条真实记录（同时重新绑定当前工件）：

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && pnpm run build 2>&1 | tail -5` 预期：完成并打印 `build: recorded N client artifact(s)` 行。

重新运行打包；它应通过门禁并到达部署步骤：

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop/apps/desktop && node scripts/package.mjs --mac 2>&1 | grep -E "client build record verified|deploying @deepseek-ai/dsh" | head` 预期：先打印 `client build record verified`，再打印 `deploying @deepseek-ai/dsh production installation`。（让它跑完或在部署开始后中断即可 — 重点是门禁已通过。）

- [ ] **步骤 5：提交**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add apps/desktop/scripts/package.mjs
git commit -m "feat(desktop): gate packaging on the client build record"
```

---

### 任务 3：Agent Note + README

**文件：**
- 新建：`.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.md`（英文）
- 新建：`.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.zh.md`（中文）
- 新建：sidecar `.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.yaml`（或格式门禁期望的 sidecar 名）
- 修改：`apps/desktop/README.md` 和 `apps/desktop/README.zh.md`（打包前置条件）

**接口：**
- 消费：任务 1-2 交付的门禁（路径/名称以实际实现为准）。
- 产出：一份 `process` 类 Agent Note，记录该决策（硬记录门禁、复用优于 mtime、手工构建失败类别）及 README 打包步骤。

> Agent Note 格式由 `pnpm run verify-agent-note-format` 强制，并受 `dsh-agent-notes` 技能管辖。按该技能生成英文 + 中文 + sidecar 三元组；代码交付后将其移入 `implemented/`（同一变更集）。

- [ ] **步骤 1：在 `proposed/` 起草 Agent Note（英文）**

创建 `.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.md`，遵循仓库统一格式（头部块按 `.agents/notes/README.md`）。需记录的内容：
- **决策：** `apps/desktop/scripts/package.mjs` 以 `readClientBuildRecord(repoRoot)` 通过（记录存在 + 工件摘要匹配）作为打包门禁，通过新的 `verify-build-record.mts`、经 `node --import tsx` 调用。
- **为何硬门禁 + 摘要：** 软警告保留坏 app 的失败模式；mtime 在 CI/拷贝/`pnpm deploy` 之间不可靠。摘要已被发布流程信任（`scripts/release/families.ts`）。
- **这消除了什么：** “我以为我构建过”这一类 — 手工运行 `vite build`/`tsdown` face 不产生记录，因此打包现在以清晰的 `pnpm run build` 提示失败，而不是静默发布陈旧/不完整的树。
- **被否决的替代方案：** mtime 新鲜度检查；在打包脚本中重新实现摘要（会使“完整客户端构建”的定义分叉）；仅警告。
- **范围：** 仅打包脚本 + 入口 + 测试；不改 `scripts/build.ts` 或记录格式。

- [ ] **步骤 2：编写中文对应文档**

创建 `...zh.md`，按仓库双语格式镜像英文 note。

- [ ] **步骤 3：创建 sidecar 并校验三元组**

运行格式门禁确认三元组格式正确：

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && pnpm run verify-agent-note-format 2>&1 | tail -15` 预期：新 note 通过（或门禁打印它需要的确切 sidecar 名/字段 — 修复后重跑）。

- [ ] **步骤 4：更新两份 README 的打包章节**

在 `apps/desktop/README.md`（及 `README.zh.md`）中，凡记录打包之处，添加前置条件：

> 打包前先从仓库根运行 `pnpm run build`（官方品牌为 `pnpm run build:official`）；`scripts/package.mjs` 现在拒绝在生成的客户端构建记录与磁盘工件不匹配时运行。

- [ ] **步骤 5：提交**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate* apps/desktop/README.md apps/desktop/README.zh.md
git commit -m "docs(desktop): record the packaging build-record gate decision"
```

---

### 任务 4：将 note 移入 `implemented/` 并运行聚焦门禁集

**文件：**
- 移动：`.agents/notes/proposed/process/2026-08-22-*.md` → `.agents/notes/implemented/process/2026-08-22-*.md`（全部三个三元组文件）

**接口：**
- 消费：任务 1-2 交付的代码。
- 产出：一份定稿的 `implemented/` note 和一次绿色的聚焦检查运行。

- [ ] **步骤 1：将三元组移入 `implemented/` 并修正入链**

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && git mv .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.md .agents/notes/implemented/process/ 2>/dev/null; git mv .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.zh.md .agents/notes/implemented/process/ 2>/dev/null; git mv .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.yaml .agents/notes/implemented/process/ 2>/dev/null; ls .agents/notes/implemented/process/ | grep 2026-08-22-desktop` 预期：三个文件出现在 `implemented/process/` 下。（若 sidecar 文件名与 `.yaml` 不同，按任务 3 步骤 3 实际产出的名称调整。）

- [ ] **步骤 2：运行聚焦检查**

运行：`cd /Users/dingpc/workspace/deepseek-harness-desktop && ./node_modules/.bin/vitest run apps/desktop/tests/verify-build-record.spec.ts && pnpm run verify-agent-note-format 2>&1 | tail -5` 预期：3 个测试通过；note 格式门禁绿色。

- [ ] **步骤 3：提交**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add -A .agents/notes/
git commit -m "docs(desktop): mark the build-record gate note implemented"
```

---

## 自查

**规格覆盖：**
- 复用 `readClientBuildRecord` 的硬记录门禁 → 任务 1（`verify`）+ 任务 2（接入）。✔
- 保留两个文件存在性预检 → 任务 2 步骤 2（插入在其后，而非替换）。✔
- 门禁在 `rmSync(out)`/部署之前运行 → 任务 2 步骤 2（插入在 `platformFlag`/`rmSync` 之前）+ 步骤 3 验证。✔
- 错误文案点名 `pnpm run build` / `build:official` → 任务 1 步骤 3（`main`）+ 任务 2 步骤 2。✔
- 经 `node --import tsx` 进入，desktop 无 tsx 依赖 → 任务 1 步骤 5 + 任务 2 步骤 2 + 全局约束。✔
- 测试：通过 / 记录缺失 / 工件陈旧，使用真实 `writeClientBuildRecord` → 任务 1 步骤 1。✔
- Agent Note 类别 `process`，EN+ZH+sidecar → 任务 3。✔
- README EN+ZH 前置条件 → 任务 3 步骤 4。✔
- 范围外（不改 `build.ts`/记录格式）→ 无任务触碰它们。✔

**占位符扫描：** 无 TBD/TODO；每个代码步骤都有完整内容；Agent Note 内容是逐条列举的（而非“写个 note”）。唯一软点 — sidecar 确切文件名 — 由针对真实格式门禁的“修复后重跑”处理（sidecar 名以门禁为权威），这是可接受的，因为该细节归门禁所有而非计划。

**类型一致性：** `verify(repoRoot: string): void` 和 `main(): void` 在任务 1 定义，由测试（任务 1）和 `package.mjs`（任务 2，经子进程，无类型耦合）消费。`readClientBuildRecord`/`writeClientBuildRecord` 签名与 `scripts/client-build-environment.ts` 一致。仓库根的 `..` 数量在任务 1 步骤 3 中显式说明，并有验证步骤（步骤 5）捕获错误，因为它是唯一手工计算的取值。
