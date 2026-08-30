# Agent Note: Right-side document panel as a layout grid column

Status: implemented

English | [中文](2026-08-28-doc-panel-grid-column.zh.md)

## Problem

The web GUI had no surface for reading workspace files next to the conversation: a user who wanted to preview a Markdown doc, an HTML artifact, or a source file while working had to leave the page. The request arrived as "a plugin that adds a collapsible right-side area with multi-tab document display, code highlighting, Markdown and HTML rendering."

## Decision

A static client package `@deepseek-ai/dsh-client-ui-doc-panel` registers AppFrame's `docPanel` single slot — the column between the conversation and details columns — through declaration-aware `ctx.slots.inject()`. Column geometry is owned by ui-layout, not the panel: the layout store holds open/closed and width (320–720px, default 480), drag resize rides the floating pill handle on the column boundary, and the concession chain orders details first (transient) then the doc panel (standing user intent), each auto-closing to zero width as the viewport narrows and restoring from its stored preference when it widens again. The panel triggers open/close through the cross-plugin `ctx.layout` face (`openDocPanel`/`closeDocPanel`). The column body stays mounted in both states: collapsed, the track animates to zero width and clips it (the body is `inert` for the collapsed lifetime) while the persistent reopen icon button portaled into the frame's overlay layer is hidden; expanded, the body fills the column with a header (title, auto-follow toggle, collapse control), a tab bar, and the active view. Both toggles match the sidebar's borderless circular icon-button style (mirrored `IconPanelRightOutline16`), with tooltips placed below (`side="bottom"`) to keep the bubble clear of the viewport's right edge; trigger timing that keeps clicks from flashing a bubble — and parked cursors from popping one — is owned by [Tooltip bubbles must not flash on toggle-button clicks](../bug-fix/2026-08-30-tooltip-click-flash.md), and the reopen button's un-hide timing (waiting for the track to settle so both toggles never paint together) is owned by [Doc panel toggles must not paint twice during the column transition](../bug-fix/2026-08-30-doc-panel-toggle-double-button.md).

Tabs are content-addressed by path: one global cache entry per file, one ordered tab set plus active selection per session (newest-first eviction past ten sessions). Shape derives from extension — Markdown (rendered/source toggle), HTML (scriptless sandboxed iframe), code (CodeMirror 6 with guarded editing — [doc-panel code editor](2026-08-29-doc-panel-codemirror-editor.md)).

The panel carries a pinned Changes tab over the current session's `fileChanges` projection ([dsh-file-changes](../../../../packages/session/file-changes/README.md)): per-path rows with added/removed/edit counts and an expandable diff through ui-primitives' DiffBlock; clicking a row opens the file. Auto-follow (default on) opens a tab and opens the panel column for strictly newer touches, re-baselining the per-path `lastAt` map on session switch so pre-existing changes never flood the strip. Reads go through the runtime's `workspaces.readTextFile`, which the API gateway serves directly from the host filesystem under every composed picker kind — deliberately not a directory-picker capability, because a native desktop must open its own changed files; failures surface as their wire code.

Load-bearing choices:

- **Tabs key content by path, not by session.** The same file opened in two sessions shares one cache entry and one in-flight read; the per-session state is only the ordered tab set and the active id. A per-session content cache would re-read files on every session switch for zero user-visible gain.
- **The Markdown renderer is owned and element-built, not an external parser.** No `innerHTML` anywhere: blocks and inline runs become React elements from a small block/inline pass, and link targets naming a scheme before the first `/`, `?`, or `#` are refused. A full CommonMark dependency buys tables and task lists at the cost of a security surface (HTML passthrough options) this panel does not need; the gap is documented in the README instead.
- **Panel geometry lives in the layout store, not the panel's store.** Auto-close on narrow viewports and restore-on-widen are properties of the grid solver's concession chain; an absolutely positioned column cannot participate in it. The panel's own store keeps only viewing state (auto-follow flag, per-session tab sets, content cache).

## Alternatives considered

**A dynamic Cordis plugin.** The literal reading of the request. Comparison research against Codex's equivalent surfaces first, then the repo's own convention: GUI features ship as static client packages because a process-local plugin vanishes on restart, needs per-session approval, and cannot own a durable UI seat. The prototype phase was dropped in favor of this package.

**In-panel editing.** Considered and cut from v1 after the same comparison research: an editor needs conflict policy against concurrent tool edits, save semantics over the wire, and a dirty-state model — none exist yet on the client read path. v1 is strictly read-only; the Changes tab displays diffs but never applies them.

**A directory-browse tab.** Cut: the `listDirectory` wire API returns child directories only (files are filtered out), so browsing to a file would need a host capability extension. Documented as deferred work rather than extending the host for v1.

**The overlay seat (same-day first cut).** The original design registered a keyed entry into `shell.overlay`: a floating column over the right edge with its own width state and an edge handle when collapsed. Rejected in review: the user preferred an IDE-style split where chat and documents sit side by side, and a floating overlay cannot join the layout's concession chain — auto-close on narrow viewports and restore-on-widen are grid-solver properties. The reopen affordance moved from the edge handle to a portal icon button in the overlay layer, which remains available for genuinely floating surfaces.

## Consequences

Pure presentation: no session event, request payload, or projection change; model requests render exactly as before (README Model Experience). The package couples to three cross-package facts — the `docPanel` slot name and the layout store geometry owned by ui-layout, and the `fileChanges` projection key owned by the runtime sessions store — all stable composition contracts. Changes visibility is tool-event-bound: bash commands and manual edits never appear in the tab (README limitation). HTML tabs execute no scripts. Removing the package leaves an inert `docPanel` locale namespace; AppFrame keeps rendering the empty zero-width column seat with no occupants.

## Testing

`packages/client/ui-layout/tests/`: four-column solver spec (concession order details-before-doc-panel, auto-close steps, backward compatibility with the panel closed), AppFrame spec (owner props for the docPanel seat, drag widens leftward, handle count per open state), layout store and service specs (width clamp, open/close). `packages/client/ui-doc-panel/tests/`: store spec (tab set lifecycle, eviction, content/error landing — no expanded flag), renderer and component specs, a DocPanelRoot spec on the real store engine plus a mutable sessions fixture (portal reopen button, owner-driven collapse, auto-follow baseline/follow/re-baseline opening the panel column, cwd resolution, load-on-open dedupe, no-session rendering), and an apply spec over a real SlotRegistry (late declaration install, collapse removal, teardown, `ctx.layout` wiring) — 100% per-file coverage. `pnpm run test:gui` is green; the keyless `DSH_SNAPSHOT=replay` pass of `test:web` is the assembled-browser check for the new column seat.
