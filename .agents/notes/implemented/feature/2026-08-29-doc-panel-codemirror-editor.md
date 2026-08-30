# Agent Note: Document panel code editor — CodeMirror 6 with guarded editing

Status: implemented

English | [中文](2026-08-29-doc-panel-codemirror-editor.zh.md)

## Problem

The document panel's code view rendered files through a hand-rolled line-oriented tokenizer that classified source into five token runs (comment / string / keyword / number / plain) — the surface this change retires. The result reads as crude next to the chat surface: function calls, attributes, and punctuation all render in the default color; there are no line numbers, code folding, in-file search, or active-line highlight. Highlighting is also whole-file and synchronous, so multi-megabyte files (lockfiles) stall the frame.

The product goal is an IDE-grade file-browsing experience in the document panel — the "open a file to read it" half of VS Code — plus in-place editing with safe conflict handling while the agent works on the same tree.

## Decision

The document panel ([layout and tab model](2026-08-28-doc-panel-grid-column.md)) renders its code surface with CodeMirror 6, landed in three phases; this note supersedes the grid column note's owned code tokenizer. Chat keeps its existing Shiki-based `CodeBlock` unchanged; palette consistency between the two surfaces comes from theme tokens, not shared components.

### Phase A — host write seam

- Extend the workspace-controller text-file read value (`TextFileReadValue`, `packages/api/workspace-controller/src/types.ts`) with a `version` freshness token; the read path already stats for size, so the token rides along. Pre-release wire extension: no compatibility layer.
- New `ctx.remote.workspace.writeTextFile` method (`{ path, content, expectedVersion? }`) implemented in `packages/api/workspace-controller/src/commands.ts` beside `readTextFile`. It writes node:fs directly (symmetric with the read path): a stat supplies the freshness baseline and proves the target is a regular file; a supplied `expectedVersion` that no longer matches reports `file-stale-version`, a missing or non-regular target reports `file-unwritable`, and omitting the guard is an unconditional overwrite (the conflict banner's "overwrite anyway" path). The version token (`dev:ino:size:mtimeMs:ctimeMs`) is opaque to the client — an echo-back guard, not a branded value.
- New workspace-controller `Config` field capping one write payload in bytes (`maxWriteBytes`), symmetric with the read `file-too-large` bound (`maxTextBytes`).
- The controller's `@Remote('readTextFile')` / `@Remote('writeTextFile')` methods in `packages/api/workspace-controller/src/index.ts`, and a client-side `workspaces.writeTextFile()` beside `readTextFile` (`packages/api/workspace-controller/src/client/service.ts`).

### Phase B — CodeMirror 6 read-only view

- ui-doc-panel dependencies: `@codemirror/view` / `state` / `language` plus Lezer language packages for javascript / python / json / css / html / sql; ordinary third-party libraries bundled into the package's `lib/client.js` per the dependency rules. YAML has no official Lezer grammar and stays plain text.
- A new CodeEditor component replaces the tokenizer in `code`-kind tabs: virtualized rendering (visible lines only — large files scroll smoothly), line numbers, active-line highlight, fold gutter, search, bracket matching.
- Theme: one `HighlightStyle` plus an `EditorView.theme` whose color values reference the existing `--shiki-*` / `--dsw-*` CSS custom properties (CodeMirror emits styles through a style tag, so `var()` resolves). The panel then shares the chat code-block palette with zero new color literals; the tokens-only styling rule holds.
- Delete `render/highlight.ts`, the `.tok*` CSS classes, and their tests (~300+ lines of owned tokenizer retire).

### Phase C — editing

- Store (`store.ts`): `DocTab` gains a baseline `version`, `dirty`, `saving`, and `writeError` flags. The document text lives in CodeMirror's own state, never the store — keystrokes must not pass through immer.
- Save on Cmd/Ctrl+S calls `workspaces.writeTextFile` with the `expectedVersion` guard; success refreshes the baseline version and clears dirty; the tab title shows a dirty marker. The panel's apply wiring (`index.ts`) injects a save callback beside `readFile`, closed over `ctx.workspaces`.
- Conflict handling: a save rejected with `file-stale-version`, or a `fileChanges` `lastAt` move while the tab is dirty (the projection already streams per-path), raises a tab banner — "file changed on disk" — with reload / overwrite anyway / cancel. Overwrite writes unconditionally without a second confirmation: the user just chose it explicitly.
- Closing a dirty tab asks discard-or-cancel.
- markdown/html tabs remain rendered views in v1; only `code`-kind tabs are editable.

## Consequences

- The code surface renders virtually (visible lines only), so multi-megabyte files scroll without the whole-file stall; line numbers, folding, search, and active-line highlight ship with it.
- Chat and panel share one token-driven palette: no second color table, no new color literals in ui-doc-panel CSS.
- The hand-rolled tokenizer (`render/highlight.ts`) and its tests are gone.
- The CodeMirror bundle (~100 KB gzip) lands in the dynamic plugin chunk, not the boot critical path — accepted.

## Standing constraints

- Conflict detection reuses the fs capability's version-guard semantics (a compare-and-swap on the stat-derived token) without a new conflict protocol; the host emits kebab-case RPC codes (`file-stale-version`, `file-unwritable`) to match the read path's domain, not a literal `FS_STALE_VERSION` symbol.
- One palette: CodeMirror colors reference `--shiki-*` variables so chat and panel agree; no second color table.
- No document text in the store per keystroke.
- Write size cap added as a workspace-controller `Config` field (symmetric with reads).
- Conflict overwrite is a direct write, no RiskConfirmation.

## Implementation seams

- Host: `packages/api/workspace-controller/src/types.ts` (`TextFileReadValue`, `TextFileWriteRequest`, `TextFileWriteValue`), `src/commands.ts` (implementation beside the existing `readTextFile`, and the size bounds beside the read bound), `src/index.ts` (the `@Remote` methods and the `Config` surface).
- Client: `packages/api/workspace-controller/src/client/service.ts` (+ its contract face) for `writeTextFile`.
- Panel: `packages/client/ui-doc-panel/src/client/store.ts` (tab fields + actions), a new CodeEditor component under `src/client/`, `views.tsx` (mount it for code tabs), `DocPanelRoot.module.css` (drop `.tok*`), `render/highlight.ts` (deleted), `index.ts` (save inject prop), `locales.ts` (banner/copy strings).

## Alternatives considered

- Swap only to `CodeBlock`/Shiki in the panel: fixes the palette but adds no line numbers/folding/search and keeps whole-file synchronous highlighting (the large-file stall). Rejected as the end state; Shiki stays right for chat snippets.
- Monaco (the VS Code editor core): minimap, IntelliSense, diagnostics — but ships a worker-heavy half of VS Code into the browser; disproportionate for read-browse. Revisit only if IntelliSense-grade editing is required.
- Keep the hand-rolled tokenizer and enrich its palette: does not fix the five-class sparseness or any IDE affordance.

## Testing

- Host unit tests for `writeTextFile` (stale version, size cap, non-text path) beside the existing read tests; store state-machine specs cover dirty / save / conflict / close-guard.
- A keyless e2e replay scenario (`apps/web/tests/doc-panel-edit.e2e.ts`) opens a produced file, edits it in CodeMirror, and saves with the shortcut — asserting the on-disk change and baseline refresh. It runs in a real Playwright browser: jsdom cannot drive CodeMirror input (its input path calls `Range.getClientRects`, which jsdom lacks), so keystroke editing is only simulatable against a live page; component specs assert the editor's user-visible surface instead.
- A concurrent external modification surfaces the conflict banner instead of a silent clobber; both reload and overwrite are covered by the store specs.
- Gates: `pnpm run test:gui` green; `DSH_SNAPSHOT=replay pnpm run test:web` green with the new host unit tests passing.

## Risks

- Concurrent agent/user writes are the core hazard; mitigated by the version guard plus the proactive `fileChanges` banner. A write landing between stat and write still reports stale — the safe direction.
- jsdom testing of CodeMirror is limited; component specs assert user-visible behavior through the store and DOM output, keeping editor internals thin.
- The working tree currently carries an unrelated uncommitted doc-panel button fix (reopen-button no-drag + row alignment); keep it out of this feature's changes.
