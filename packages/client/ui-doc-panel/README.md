# @deepseek-ai/dsh-client-ui-doc-panel

English | [中文](README.zh.md)

Right-side document panel for the web GUI: a collapsible grid column that renders Markdown, HTML, and code files from the session workspace, plus a pinned Changes tab over the session's file-change projection. Read-only in v1 — the panel displays; it never edits or saves. Contract: the [slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md).

The plugin registers the `docPanel` single slot declared by AppFrame (the column between the conversation and the details columns) through declaration-aware `slots.inject()`, so it installs whenever the live owner declares the seat and leaves with the plugin fiber. Column geometry — open/closed, width (320–720px, default 480), drag resize, and the concession chain that auto-closes it on narrow viewports — lives in the layout store; the panel triggers transitions through the cross-plugin `ctx.layout` face (`openDocPanel`/`closeDocPanel`). Collapsed, the column is zero width and the panel renders a reopen icon button portaled into the frame's overlay layer; expanded, it fills the column with a header (title, auto-follow toggle, collapse control), a tab bar, and the active view.

Tabs are content-addressed by path: opening the same file in several sessions shares one cache entry, so a read fires once per path. Each session keeps its own ordered tab set and active selection (newest-first eviction past ten sessions). The shape of a tab is derived from its extension: `.md`/`.markdown` render Markdown with a rendered/source toggle, `.html`/`.htm` render into a scriptless sandboxed iframe, and everything else becomes a code tab highlighted by the package's own lightweight tokenizer (JavaScript/TypeScript, Python, Bash, SQL, CSS, HTML/XML, YAML, JSON; unknown languages fall back to plain text).

The Markdown renderer is a small owned parser — headings, fenced and inline code, bold, italic, links, lists, blockquotes, and horizontal rules — built from React elements only (no `innerHTML`), and it refuses link targets that name a scheme (`javascript:`, `data:`) before the first `/`, `?`, or `#`.

The Changes tab aggregates the current session's `fileChanges` projection ([dsh-file-changes](../../session/file-changes/README.md)): one row per touched path, newest first, with added/removed/edit counts and an expandable diff through ui-primitives' DiffBlock. Rows show the cwd-relative path; the raw path rides the title. Clicking a row opens that file as a tab.

Auto-follow (on by default) opens a tab and expands the panel when a strictly newer touch appears in the projection; switching sessions re-baselines the per-path `lastAt` map so pre-existing changes never flood the tab strip. Reads go through the runtime's `workspaces.readTextFile`; failures surface as their wire code (`file-unreadable`, `file-too-large`, `binary-file`).

The store is an exclusive per-scope factory declared at register; components read it through `useStore` and write through `actions`. The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types and the store factory; DocPanelRoot, TabBar, ChangesTab, DocView, and the renderers stay package-internal.

## Model Experience

None — the panel is a pure client view over already-logged session data; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Read-only v1** — no editing or saving from the panel; the Changes tab displays diffs but never applies them.
- **Changes visibility is tool-event-bound** — only edit/write tool results folded by the projection appear; bash commands and manual edits are invisible to the tab.
- **Directory browsing is deferred** — the `listDirectory` wire API returns child directories only, so a browse-by-directory tab would need a host capability extension first.
- **HTML tabs run scriptless** — the sandboxed iframe executes no scripts and has no same-origin access; interactive documents render inert.
- **Markdown is not full CommonMark** — tables, task lists, images, and nested structures beyond one level of lists are not parsed.
