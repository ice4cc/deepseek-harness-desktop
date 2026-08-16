# Agent Note: Desktop shell ships as an Electron wrapper over the dsh web profile

Status: implemented

English | [中文](2026-08-16-desktop-shell-mode-a.zh.md)

## Problem

The product needed a desktop client with two requirements that pull against each other: deeply customized UI, and the ability to keep syncing the official mainline so new features arrive without rework. A separate native GUI would own a second rendering surface for every tool, message, and slot the web client already draws — each upstream change to the client would then need a manual port, and the two surfaces would drift. The repository had no desktop distribution at all.

## Decision

`apps/desktop` (@deepseek-ai/dsh-desktop) is an Electron shell that spawns the `dsh` web profile as a child Node process — `web --port 0`, run through Electron's own binary with `ELECTRON_RUN_AS_NODE=1` — waits for the documented readiness line (`dsh web: http://127.0.0.1:<port>`), and loads that loopback URL in one BrowserWindow. The shell adds no protocol surface: the page talks to dsh over same-origin HTTP/WebSocket exactly as in a browser, so every web client package and all slot-based UI customization work unchanged, and upstream mainline syncs land in the desktop app without any client-side porting.

Two launch layouts share one `resolveInstall()`: dev boots the source tree through tsx (`node --expose-internals --import <tsx> apps/cli/src/bin.ts web --port 0` with `TSX_TSCONFIG_PATH`) because pnpm's isolated checkout cannot serve bare `@deepseek-ai/*` names to plain Node; packaged runs `resources/dsh/lib/bin.js` under plain Node. The packaged payload is a `pnpm deploy --legacy --prod` of `@deepseek-ai/dsh` repaired by `scripts/package.mjs`: peer-only packages are injected for the duration of the deploy, store-only packages get relative top-level symlinks (the profile boot's literal-path node_modules walks cannot see through pnpm's virtual directories), the workspace's `link:vendor/*` overrides are materialized into the store (deploy preserves them as links escaping into the source checkout), and every symlink that does not resolve inside the deployment is pruned (electron-builder stats each copied file and fails on a dangling one).

Lifecycle: an explicit `app.setName('DeepSeek Harness Desktop')` keeps the single-instance lock and userData distinct from other builds sharing the workspace package name; closing the window kills the child (SIGTERM, SIGKILL after 5 s) and quits on every platform; a pidfile under `$DSH_HOME/desktop/` reaps a child left behind by a force-killed instance, killing only pids whose command line still names a dsh entry.

Window integration: on macOS the window hides the OS caption bar (`titleBarStyle: 'hiddenInset'`, `acceptFirstMouse: true`) so the traffic lights inset over the page's own top strip; Windows keeps the native frame. The shell appends `?shell=desktop` to the loaded URL, and the web entry tags `<html data-shell="desktop">`; desktop-only rules keyed on that attribute relayout the sidebar brand row into two lines (the toggle pinned at traffic-light height on line 1, the full-width wordmark below), mark the conversation column's top strip — the blank-draft hero sheet, or the session header row once a session is open — and the brand row as `-webkit-app-region: drag` with interactive descendants no-drag, and collapse the sidebar to zero width instead of the stock 56 px rail. The toggle is one persistent button portaled into the frame's overlay layer at one coordinate in both states: a fixed-position escapee of the zero-width column is not reliably carved out of the browser process's cached drag regions (real clicks land on the conversation strip's drag area — single click drags the window, double click zooms it), and one persistent node means collapse/expand swaps no DOM. Plain browser loads carry no marker and keep the stock layout; the property is inert outside Electron.

## Alternatives considered

- **In-process host inside Electron** (load the dsh boot graph as the app's own module graph, custom protocol for assets): rejected — it forks the web client's rendering and resolution paths from the browser-served ones; every upstream client change would need validation in two runtimes, and Node internal-loader requirements under the Electron binary make the host side permanently special-cased.
- **A separate native UI** (Electron/React-native drawing its own tools and messages): rejected — a second surface for everything the web client already renders is exactly the divergence cost the sync requirement rules out.
- **Packaging the source checkout directly** (bundle the repo, run from it): rejected — pnpm's isolated store is unresolvable by plain Node outside the workspace; the deploy-plus-repair pipeline is the smallest self-contained layout that boots identically to dev (same 38-entry boot graph).

## Consequences

- The desktop GUI *is* the web app: deep UI customization goes through the existing client-plugin and slot seams (Phase 2), not a parallel codebase; upstream sync conflicts only where this work intentionally touches upstream files — three mechanical manifest entries (`pnpm-workspace.yaml` allowBuilds, two `tsconfig.base.json` paths entries for the picker packages, an upstream gap this work exposed, and root `package.json` scripts) plus small desktop-shell patches on the web side (the `?shell=desktop` marker detection in `apps/web/src/main.ts`, a zero-width collapsed-sidebar track in `ui-layout`'s AppFrame, and `data-shell`-keyed blocks in `ui-sidebar`'s SidebarRoot and `ui-conversation`'s ConversationRoot). All are listed in `apps/desktop/README.md`; each web patch is an appended block or a few inserted lines that resolves as keep-ours on merge.
- The dsh child runs on Electron's bundled Node; an Electron upgrade must keep that within the repo `engines` range.
- Packaging carries four repair steps because pnpm deploy is not a plain-Node runtime layout; they are deterministic and verified by booting the deployed tree from a neutral directory.
- Deferred: tray, global shortcuts, native directory-picker backend (the picker seam already reserves an Electron-provided `native` backend), and Windows stale-child reaping (`ps` is absent there).
