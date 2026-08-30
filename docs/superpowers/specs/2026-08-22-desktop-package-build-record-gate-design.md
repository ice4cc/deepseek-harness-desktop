# Desktop packaging: build-record freshness gate

English | [中文](2026-08-22-desktop-package-build-record-gate-design.zh.md)

## Summary

`apps/desktop/scripts/package.mjs` currently gates packaging on two file-existence checks (`apps/cli/lib/bin.js` and `apps/web/dist/index.html`). That gate is blind to the two failure modes that actually bit the desktop app: a stale `apps/web/dist` (white page, `ModuleLoader` double-boot) and an incomplete client build (`lib/client.js` missing or built without the selected client profile). This change replaces that weak gate with a hard gate that reuses the repository's existing `readClientBuildRecord()` verifier, which binds a full artifact digest (`apps/web/dist/**` plus every `packages/*/*/lib/client.js`) to the recorded public client environment.

## Problem

`scripts/build.ts` (the root `pnpm run build`) already does the right thing: it runs `build:lib` (tsc + tsdown host/client faces) and `build:web` (vite) with the selected client environment, then writes `.dsh-build/client-build-environment.json` containing a SHA-256 digest of all client artifacts. `readClientBuildRecord()` (in `scripts/client-build-environment.ts`) reads that record and throws when the current artifacts no longer match the recorded digest.

But the desktop packaging path never invoked the root build through `build.ts` — the manual debugging workflow ran `vite build` and `tsdown` face-by-face by hand, so no record was ever written, and the packaging gate (two `existsSync` checks) passed silently over stale or partial artifacts. The same gap will recur for anyone who builds by hand.

## Decision

**Hard gate, reusing the existing record verifier.** Before staging the deployment, `package.mjs` runs `readClientBuildRecord(repoRoot)` and aborts packaging (exit 1) if it throws — i.e. the record is missing or the on-disk artifacts no longer match the recorded digest. The two file-existence checks are kept as a fast, friendly pre-check (clear error before the record check runs).

### Why hard + digest, and not the alternatives

- **Hard, not soft.** A warning-only gate leaves the current failure mode intact (pack succeeds, app is broken). The goal is to fail before packaging, so a missing or stale record must stop the build.
- **Digest, not mtime.** mtime-based freshness checks are unreliable across CI, copy, and `pnpm deploy` (which rewrites mtimes). A content digest is exact and is already the mechanism the release flow trusts (`scripts/release/families.ts:328` calls `readClientBuildRecord(root, officialClientBuildEnvironment(root))`).
- **Reuse, not a new verifier.** `readClientBuildRecord` already computes the digest over the complete artifact set. Re-implementing it in the packaging script would fork the definition of "complete client build" and drift.

### Correct packaging workflow after this change

1. `pnpm run build` (local profile) or `pnpm run build:official` (official brand) — this writes the record.
2. `node apps/desktop/scripts/package.mjs [--mac|--win|--linux]`.

Hand-building the client artifacts (running `vite build` / `tsdown` faces directly) produces no record, so packaging fails with a clear message. That is intentional: it removes the "I thought I built it" failure class.

## Components

### 1. `apps/desktop/scripts/verify-build-record.mts` (new)

A small entrypoint the packaging script invokes via `node --import tsx` (the repository's established pattern for `.mjs` → `.ts`, see `scripts/demo-cordis.mjs:9`). It:

- Resolves the repository root (two levels up from `apps/desktop/scripts`).
- `import`s `readClientBuildRecord` from `<root>/scripts/client-build-environment.ts`.
- Calls `readClientBuildRecord(root)`.
- On success: prints a one-line confirmation and exits 0.
- On throw: prints the error message plus the remediation hint (`run \`pnpm run build\` from the repository root` — or `pnpm run build:official` for the official brand) and exits 1.

Kept as a separate file (not an inline `node -e` string) so it is unit-testable and readable. ~25 lines.

### 2. `apps/desktop/scripts/package.mjs` (modified)

Replace the two-artifact existence loop's role as *the* gate:

- Keep the two `existsSync` checks (fast, friendly).
- Add, immediately after them, a call to `verify-build-record.mts` via `node --import tsx <abs path to the .mts>`. Non-zero exit → `console.error` with the captured reason and `process.exit(1)`.
- Update the module header doc (step 1) to describe the record gate.

The `tsx` binary is resolved from the repository root `node_modules/.bin` (the desktop package does not depend on tsx; it is a root devDependency, and the packaging script already runs from the repo checkout).

### 3. `apps/desktop/tests/verify-build-record.spec.ts` (new)

Vitest unit tests for the gate behavior, using a temporary directory as a fake repo root so the test does not depend on a real `.dsh-build` record:

- **Pass**: a valid record whose digest matches the fake artifacts → exit 0 / no throw.
- **Missing record**: no `.dsh-build/client-build-environment.json` → throws with the "run pnpm run build" remediation.
- **Stale artifact**: a record is written, then one artifact's bytes change → digest mismatch → throws.

The test constructs records through the same `writeClientBuildRecord` helper the real build uses, so it exercises the real digest path rather than a hand-rolled fixture.

## Error handling

- Missing record → `readClientBuildRecord` throws `client build record ... is missing; run a complete pnpm run build first`. The gate surfaces this plus the `build:official` variant hint.
- Digest mismatch → `client artifacts differ from ...; run a complete pnpm run build before consuming them`.
- Both map to exit 1 before any `rmSync(out)` or deploy work happens, so a failed gate leaves the previous `out/` and installed app untouched.

## Files touched

- `apps/desktop/scripts/package.mjs` — gate + header doc.
- `apps/desktop/scripts/verify-build-record.mts` — new entrypoint.
- `apps/desktop/tests/verify-build-record.spec.ts` — new tests.
- Agent Note (proposed/ → implemented/) — class `process` (tooling/gate, not runtime behavior); English + Chinese + sidecar per the `dsh-agent-notes` format.
- `apps/desktop/README.md` / `README.zh.md` — document the new packaging prerequisite (`pnpm run build` before `package.mjs`).

## Out of scope

- No changes to `scripts/build.ts`, `scripts/client-build-environment.ts`, or the record format — the mechanism is correct; it was simply not wired into packaging.
- No mtime-based checks.
- No new dependency in `apps/desktop/package.json` (tsx is reused from the repo root).

## Verification

- `pnpm run test` covers the new unit tests.
- Manual: hand-build without the root `build.ts` (no record) → `package.mjs` fails with the clear message. Then `pnpm run build` → `package.mjs` proceeds.
- Existing `pnpm run build:official` flow still produces a record the gate accepts.
