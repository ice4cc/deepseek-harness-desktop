# Desktop Packaging Build-Record Gate — Implementation Plan

English | [中文](2026-08-22-desktop-package-build-record-gate.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/desktop/scripts/package.mjs` refuse to package unless the repository's client build record (`.dsh-build/client-build-environment.json`) exists and its artifact digest matches the on-disk artifacts, so stale `apps/web/dist` or a missing/partial client build fails before packaging instead of producing a broken app.

**Architecture:** A new small `verify-build-record.mts` entrypoint imports `readClientBuildRecord` from `scripts/client-build-environment.ts` and exits non-zero on any throw. `package.mjs` invokes it via `node --import tsx` (the repo's established `.mjs`→`.ts` pattern, see `scripts/demo-cordis.mjs:9`) right after its existing file-existence pre-check, aborting packaging on failure. Unit tests exercise the pass / missing-record / stale-artifact paths against a temp-dir fake repo root using the real `writeClientBuildRecord` helper.

**Tech Stack:** Node (ESM), `tsx` (root devDependency), vitest, the existing `readClientBuildRecord`/`writeClientBuildRecord` from `scripts/client-build-environment.ts`.

## Global Constraints

- ESM everywhere (`"type": "module"`); local relative imports use the `.ts` extension (e.g. `import { x } from '../../../scripts/client-build-environment.ts'`).
- `apps/desktop/package.json` must NOT gain a `tsx` dependency — tsx is resolved from the repository root `node_modules/.bin`.
- The gate must run BEFORE `rmSync(out)` / deploy so a failure leaves the prior `out/` and installed app untouched.
- Error copy must tell the user to run `pnpm run build` (or `pnpm run build:official` for the official brand).
- Agent Note is class `process` (tooling/gate, not runtime behavior); English + Chinese + sidecar per the repo's `verify-agent-note-format` gate.
- Tests live at `apps/desktop/tests/**/*.spec.ts` (matched by the root `vitest.config.ts` `testIncludes` entry `apps/*/tests/**/*.spec.ts`).
- Run focused checks only; `pnpm run test` covers the new suite. Do not default to the full repo suite.

---

### Task 1: `verify-build-record.mts` entrypoint + unit tests

**Files:**
- Create: `apps/desktop/scripts/verify-build-record.mts`
- Test: `apps/desktop/tests/verify-build-record.spec.ts`

**Interfaces:**
- Consumes: `readClientBuildRecord(root: string, expected?: ...)` and `writeClientBuildRecord(root: string, environment: ClientBuildEnvironment)` from `scripts/client-build-environment.ts`. The entrypoint is a thin `main()` that calls `readClientBuildRecord` on the repo root; tests import the exported `verify(repoRoot: string)` function (pure: throws on failure, returns void on success) rather than the process-level `main()`, so they don't fork a child.
- Produces:
  - `verify(repoRoot: string): void` — throws (propagating `readClientBuildRecord`'s error) when the record is missing or the artifact digest mismatches; returns `undefined` on success.
  - `main(): void` — resolves the repo root (three levels up from `apps/desktop/scripts`), calls `verify`, prints a one-line confirmation on success; on error prints the message plus the remediation hint and sets `process.exitCode = 1`.
  - When run directly (`node --import tsx verify-build-record.mts`), calls `main()` (guarded by `import.meta.main`).

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/tests/verify-build-record.spec.ts`:

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

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && ./node_modules/.bin/vitest run apps/desktop/tests/verify-build-record.spec.ts` Expected: FAIL — `Cannot find module '../scripts/verify-build-record.mts'` (the entrypoint does not exist yet).

- [ ] **Step 3: Write the entrypoint**

Create `apps/desktop/scripts/verify-build-record.mts`:

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

Note: the entrypoint lives at `apps/desktop/scripts/`, so the repo root is **four** levels up (`scripts` → `desktop` → `apps` → root is three; but `fileURLToPath(import.meta.url)` is the file itself, so `..` is `scripts`, `..` `desktop`, `..` `apps`, `..` root = four `..`). The test imports the file by relative path, so it is not affected by this resolution.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && ./node_modules/.bin/vitest run apps/desktop/tests/verify-build-record.spec.ts` Expected: PASS (3 tests).

- [ ] **Step 5: Verify the entrypoint runs standalone and the root resolution is correct**

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && node --import tsx apps/desktop/scripts/verify-build-record.mts; echo "exit=$?"` Expected: if a record exists, prints the verified line and `exit=0`; if not, prints the failure + hint and `exit=1`. Confirm the resolved root is the repo root (the error message should reference `.dsh-build/client-build-environment.json` at the repo, not a nested path). Adjust the number of `..` segments in Step 3 if the path is wrong.

- [ ] **Step 6: Commit**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add apps/desktop/scripts/verify-build-record.mts apps/desktop/tests/verify-build-record.spec.ts
git commit -m "test(desktop): add build-record verification entrypoint and tests"
```

---

### Task 2: Wire the gate into `package.mjs`

**Files:**
- Modify: `apps/desktop/scripts/package.mjs` (header doc step 1, and the artifact-check block at lines 239-244)

**Interfaces:**
- Consumes: `verify-build-record.mts` from Task 1, invoked as a child via `node --import tsx <abs path>`.
- Produces: `package.mjs` aborts with `process.exit(1)` (before `rmSync(out)`) when the record gate fails; proceeds unchanged when it passes.

- [ ] **Step 1: Update the header doc**

In `apps/desktop/scripts/package.mjs`, change the step-1 line in the module JSDoc (currently `* 1. Verifies the dsh build artifacts exist (...)`) to:

```
 * 1. Verifies the dsh build artifacts exist and the client build record
 *    (.dsh-build/client-build-environment.json) still matches them via
 *    scripts/verify-build-record.mts — a stale apps/web/dist or a partial client
 *    build aborts here instead of shipping a broken app.
```

- [ ] **Step 2: Add the record gate after the artifact pre-check**

In `package.mjs`, immediately after the existing `for (const artifact of [...])` existence loop (lines 239-244), and BEFORE `const platformFlag = ...` (line 248), insert:

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

(No `tsx` import needed — `--import tsx` is resolved by Node against the repo root because `cwd` is inherited from the packaging invocation, which runs from within the checkout. `execFileSync` with `stdio: 'inherit'` already streams the child's own error/hint lines.)

- [ ] **Step 3: Verify the gate aborts packaging when no record exists**

First ensure no record is present (the gate's negative case):

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && ls .dsh-build/client-build-environment.json 2>/dev/null || echo "no record (good for this negative test)"`

Then run the packaging script and confirm it stops at the gate, before deploy:

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop/apps/desktop && node scripts/package.mjs --mac 2>&1 | grep -E "build-record gate|client build record|deploying" ; echo "exit=${PIPESTATUS[0]}"` Expected: prints the `build-record gate failed` line (and the child's hint), does NOT print `deploying @deepseek-ai/dsh`, and `exit=1`.

- [ ] **Step 4: Verify the gate passes and packaging proceeds when a record exists**

Generate a real record by running the root build (this also re-binds the current artifacts):

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && pnpm run build 2>&1 | tail -5` Expected: completes and prints the `build: recorded N client artifact(s)` line.

Re-run packaging; it should clear the gate and reach the deploy step:

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop/apps/desktop && node scripts/package.mjs --mac 2>&1 | grep -E "client build record verified|deploying @deepseek-ai/dsh" | head` Expected: prints `client build record verified` then `deploying @deepseek-ai/dsh production installation`. (Let it finish or interrupt after deploy begins — the point is the gate passed.)

- [ ] **Step 5: Commit**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add apps/desktop/scripts/package.mjs
git commit -m "feat(desktop): gate packaging on the client build record"
```

---

### Task 3: Agent Note + README

**Files:**
- Create: `.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.md` (English)
- Create: `.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.zh.md` (Chinese)
- Create: sidecar `.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.yaml` (or the sidecar name the format gate expects)
- Modify: `apps/desktop/README.md` and `apps/desktop/README.zh.md` (packaging prerequisite)

**Interfaces:**
- Consumes: the shipped gate from Tasks 1-2 (paths/names as implemented).
- Produces: a `process`-class Agent Note recording the decision (hard record gate, reuse over mtime, hand-build failure class) and README packaging steps.

> Agent Note format is enforced by `pnpm run verify-agent-note-format` and governed by the `dsh-agent-notes` skill. Generate the English + Chinese + sidecar triplet per that skill; move it to `implemented/` once the code ships (same change set).

- [ ] **Step 1: Draft the Agent Note (English) in `proposed/`**

Create `.agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.md` following the repo's uniform format (header block per `.agents/notes/README.md`). Content to capture:
- **Decision:** `apps/desktop/scripts/package.mjs` gates packaging on `readClientBuildRecord(repoRoot)` passing (record present + artifact digest matches), invoked via a new `verify-build-record.mts` through `node --import tsx`.
- **Why hard + digest:** soft warnings preserve the broken-app failure mode; mtime is unreliable across CI/copy/`pnpm deploy`. The digest is already trusted by the release flow (`scripts/release/families.ts`).
- **What this removes:** the "I thought I built it" class — hand-running `vite build`/`tsdown` faces produces no record, so packaging now fails with a clear `pnpm run build` hint instead of silently shipping a stale/partial tree.
- **Rejected alternatives:** mtime freshness checks; a re-implemented digest in the packaging script (would fork the definition of "complete client build"); warning-only.
- **Scope:** packaging script + entrypoint + tests only; no change to `scripts/build.ts` or the record format.

- [ ] **Step 2: Write the Chinese counterpart**

Create `...zh.md` mirroring the English note per the repo's bilingual format.

- [ ] **Step 3: Create the sidecar and validate the triplet**

Run the format gate to confirm the triplet is well-formed:

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && pnpm run verify-agent-note-format 2>&1 | tail -15` Expected: the new note passes (or the gate prints the exact sidecar name/field it needs — fix and re-run).

- [ ] **Step 4: Update both READMEs' packaging section**

In `apps/desktop/README.md` (and `README.zh.md`), wherever packaging is documented, add the prerequisite:

> Run `pnpm run build` (or `pnpm run build:official` for the official brand) from the repository root before packaging; `scripts/package.mjs` now refuses to run unless the resulting client build record matches the on-disk artifacts.

- [ ] **Step 5: Commit**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate* apps/desktop/README.md apps/desktop/README.zh.md
git commit -m "docs(desktop): record the packaging build-record gate decision"
```

---

### Task 4: Move the note to `implemented/` and run the focused gate set

**Files:**
- Move: `.agents/notes/proposed/process/2026-08-22-*.md` → `.agents/notes/implemented/process/2026-08-22-*.md` (all three triplet files)

**Interfaces:**
- Consumes: shipped code from Tasks 1-2.
- Produces: a finalized `implemented/` note and a green focused check run.

- [ ] **Step 1: Move the triplet to `implemented/` and fix inbound links**

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && git mv .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.md .agents/notes/implemented/process/ 2>/dev/null; git mv .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.zh.md .agents/notes/implemented/process/ 2>/dev/null; git mv .agents/notes/proposed/process/2026-08-22-desktop-package-build-record-gate.yaml .agents/notes/implemented/process/ 2>/dev/null; ls .agents/notes/implemented/process/ | grep 2026-08-22-desktop` Expected: the three files now appear under `implemented/process/`. (Adjust the sidecar filename to whatever Task 3 Step 3 produced if it differs from `.yaml`.)

- [ ] **Step 2: Run the focused checks**

Run: `cd /Users/dingpc/workspace/deepseek-harness-desktop && ./node_modules/.bin/vitest run apps/desktop/tests/verify-build-record.spec.ts && pnpm run verify-agent-note-format 2>&1 | tail -5` Expected: 3 tests pass; the note format gate is green.

- [ ] **Step 3: Commit**

```bash
cd /Users/dingpc/workspace/deepseek-harness-desktop
git add -A .agents/notes/
git commit -m "docs(desktop): mark the build-record gate note implemented"
```

---

## Self-Review

**Spec coverage:**
- Hard record gate reusing `readClientBuildRecord` → Task 1 (`verify`) + Task 2 (wiring). ✔
- Keep the two file-existence pre-checks → Task 2 Step 2 (inserted after, not replacing). ✔
- Gate runs before `rmSync(out)`/deploy → Task 2 Step 2 (inserted before `platformFlag`/`rmSync`) + verified in Step 3. ✔
- Error copy names `pnpm run build` / `build:official` → Task 1 Step 3 (`main`) + Task 2 Step 2. ✔
- Entry via `node --import tsx`, no tsx dep in desktop → Task 1 Step 5 + Task 2 Step 2 + Global Constraints. ✔
- Tests: pass / missing-record / stale-artifact via real `writeClientBuildRecord` → Task 1 Step 1. ✔
- Agent Note class `process`, EN+ZH+sidecar → Task 3. ✔
- README EN+ZH prerequisite → Task 3 Step 4. ✔
- Out of scope (no `build.ts`/record-format changes) → no task touches them. ✔

**Placeholder scan:** no TBD/TODO; every code step has full content; the Agent Note content is enumerated (not "write a note"). The one soft spot — exact sidecar filename — is handled by "fix and re-run" against the real format gate (the gate is authoritative for the sidecar name), which is acceptable because the gate, not the plan, owns that detail.

**Type consistency:** `verify(repoRoot: string): void` and `main(): void` are defined in Task 1 and consumed by the test (Task 1) and `package.mjs` (Task 2, via child process, no type coupling). `readClientBuildRecord`/`writeClientBuildRecord` signatures match `scripts/client-build-environment.ts`. The repo-root `..` count is called out explicitly in Task 1 Step 3 with a verification step (Step 5) to catch it, since it is the one hand-computed value.
