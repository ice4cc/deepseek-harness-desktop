---
description: "Document panel for the Web GUI: a collapsible column that renders Markdown, HTML, and code files from the session workspace with editable, conflict-guarded code tabs, plus a pinned Changes tab; for users and maintainers of the Web file-browsing experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-doc-panel

English | [中文](README.zh.md)

## Summary

This package gives the Web GUI its right-side document panel: a collapsible column beside the conversation where you browse session-workspace files. Markdown renders with a rendered/source toggle, HTML renders into a scriptless sandboxed iframe, and code opens in a CodeMirror 6 editor where you can edit and save with a conflict guard. A pinned Changes tab lists every file the current session touched with expandable diffs, and auto-follow (on by default) opens tabs as the agent works. The panel is a pure client view: reads and writes ride the workspace controller's text-file surface, and nothing here reaches a model request.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin row in the web-app module table; it waits for AppFrame to declare the `docPanel` slot and installs itself whenever a live owner declares the seat. You then get the column, its tabs, and the Changes tab with no further wiring.

### Tabs and views

Tabs are content-addressed by path: opening the same file in several sessions shares one cache entry, so a read fires once per path. Each session keeps its own ordered tab set and active selection (newest-first eviction past ten sessions). The shape of a tab derives from its extension: `.md`/`.markdown` render Markdown with a rendered/source toggle, `.html`/`.htm` render into a scriptless sandboxed iframe, and everything else becomes a code tab.

The Markdown renderer is a small owned parser — headings, fenced and inline code, bold, italic, links, lists, blockquotes, and horizontal rules — built from React elements only (no `innerHTML`), and it refuses link targets that name a scheme (`javascript:`, `data:`) before the first `/`, `?`, or `#`.

### Editing and saving

Code tabs open in CodeMirror 6: virtualized rendering (visible lines only, so multi-megabyte files scroll smoothly), line numbers, active-line highlight, folding, search, and bracket matching. Lezer grammars cover JavaScript/TypeScript, Python, JSON, CSS, HTML, and SQL; YAML and unknown languages render as plain text. The document text lives in the editor's own state, never the store.

Save on Cmd/Ctrl+S writes through `workspaces.writeTextFile` with an `expectedVersion` guard — a stat-derived token echoed back from the read. Success refreshes the baseline version and clears the dirty marker on the tab title. A save rejected as stale, or a projection touch while the tab is dirty, raises a conflict banner with reload / overwrite / cancel; overwrite writes unconditionally, because you just chose it. Closing a dirty tab asks discard-or-cancel.

### Changes tab

The Changes tab aggregates the current session's `fileChanges` projection ([dsh-file-changes](../../session/file-changes/README.md)): one row per touched path, newest first, with added/removed/edit counts and an expandable diff through ui-primitives' DiffBlock. Rows show the cwd-relative path; the raw path rides the title. Clicking a row opens that file as a tab.

### Auto-follow

Auto-follow (on by default) opens a tab and expands the panel when a strictly newer touch appears in the projection; switching sessions re-baselines the per-path `lastAt` map so pre-existing changes never flood the tab strip. Reads go through `workspaces.readTextFile`; failures surface as their wire code (`file-unreadable`, `file-too-large`, `binary-file`).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin registers the `docPanel` single slot declared by AppFrame (the column between the conversation and the details columns) through declaration-aware `slots.inject()`, so it installs whenever the live owner declares the seat and leaves with the plugin fiber. Column geometry — open/closed, width (320–720px, default 480), drag resize, and the concession chain that auto-closes it on narrow viewports — lives in the layout store; the panel triggers transitions through the cross-plugin `ctx.layout` face (`openDocPanel`/`closeDocPanel`). The column body stays mounted in both states: collapsed, the track animates to zero width and clips it (the body is `inert` for the collapsed lifetime) while the persistent reopen icon button portaled into the frame's overlay layer is hidden; expanded, the body fills the column with a header (title, auto-follow toggle, collapse control), a tab bar, and the active view.

The store is an exclusive per-scope factory declared at register; components read it through `useStore` and write through `actions`. The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types and the store factory; DocPanelRoot, TabBar, ChangesTab, CodeEditor, and the renderers stay package-internal.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Slot registration; read/save callbacks closed over `ctx.workspaces` |
| [`src/client/store.ts`](src/client/store.ts) | Tab state machine: content, baseline version, dirty/saving flags, conflict state |
| [`src/client/CodeEditor.tsx`](src/client/CodeEditor.tsx) | CodeMirror 6 view with theme tokens and the save shortcut |
| [`src/client/ChangesTab.tsx`](src/client/ChangesTab.tsx) | Projection rows and DiffBlock expansion |
| [`src/client/locales.ts`](src/client/locales.ts) | Panel copy in the `docPanel` locale namespace |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-layout](../ui-layout/README.md) — declares the `docPanel` column seat and owns its geometry.
- [dsh-file-changes](../../session/file-changes/README.md) — the projection behind the Changes tab.
- [Document panel code editor note](../../../.agents/notes/implemented/feature/2026-08-29-doc-panel-codemirror-editor.md) — the CodeMirror decision and the guarded write seam.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.
- [Workspaces subsystem page](../../../docs/subsystems/workspace.md) — the text-file read/write wire surface.

-----

<a id="model-experience"></a>
## Model Experience

None, as the plugin only renders and edits session workspace files in a client-side panel and contributes no model-visible input.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current panel surface. They are package constraints, not a general editor comparison or a task backlog.

- **Code tabs only are editable** — markdown/html tabs remain rendered views; editing is confined to code-kind tabs.
- **Changes visibility is tool-event-bound** — only edit/write tool results folded by the projection appear; bash commands and manual edits are invisible to the tab.
- **Directory browsing is deferred** — the panel opens files by path only; a browse-by-directory view would need its own host capability.
- **HTML tabs run scriptless** — the sandboxed iframe executes no scripts and has no same-origin access; interactive documents render inert.
- **Markdown is not full CommonMark** — tables, task lists, images, and nested structures beyond one level of lists are not parsed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
