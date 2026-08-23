# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Electron desktop shell over the dsh web GUI (Mode A: loopback HTTP). The main process spawns the `dsh` web profile as a child Node process (`web --port 0 --no-open` — the GUI lives in the app's own window, so no system-browser handoff; run through Electron's own binary with `ELECTRON_RUN_AS_NODE=1`), waits for the documented readiness line (`dsh web: http://127.0.0.1:<port>`), and loads that loopback URL in one BrowserWindow. The GUI is served by `dsh-host-webserver` bound to 127.0.0.1 only; the shell adds no protocol surface — the page talks to dsh over same-origin HTTP/WebSocket exactly as in a browser, so every web client package (and all slot-based UI customization) works unchanged.

## Run from source

```sh
pnpm run build                                  # builds apps/cli lib + frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run dev  # electron . over the repo checkout
```

The dev layout launches the dsh bin **from source through tsx** (`node --expose-internals --import <tsx> <repo>/apps/cli/src/bin.ts web --port 0 --no-open` with `TSX_TSCONFIG_PATH=<repo>/tsconfig.json`): the pnpm-isolated checkout cannot serve the repo's bare `@deepseek-ai/*` names to plain Node, so source launches go through tsx's tsconfig-paths resolution — the same contract the keyless web smoke uses. The full environment is passed through, so `DEEPSEEK_API_KEY` (or configured providers) reach the host.

`--expose-internals` is required by the cordis HMR service: it needs Node's internal ESM loader, and under Electron's bundled Node (RUN_AS_NODE mode) the `node-addon-require-builtin` fallback that plain source launches rely on is not guaranteed to load.

## Lifecycle semantics

- Single-instance lock: a second launch focuses the existing window and exits without touching the running child.
- Closing the window terminates the child (SIGTERM, SIGKILL after 5 s) and quits on every platform — deliberately, so closing the app never leaves the agent host running unattended.
- An early child exit shows a dialog with the stderr tail and quits.
- A pidfile at `$DSH_HOME/desktop/dsh-child.pid` reaps a dsh child left behind by a force-killed previous instance; the pid is only killed when its command line still names the dev source entry (`apps/cli/src/bin.ts`) or the packaged bin (`dsh/lib/bin.js`).

## Window integration

macOS and Windows both hide the OS caption bar so the page's own top strip carries the window: macOS insets the traffic lights (`titleBarStyle: 'hiddenInset'`), Windows floats only the native min/max/close buttons over that same 44 px band (`titleBarStyle: 'hidden'` + `titleBarOverlay`); Linux keeps the stock frame and menu bar. `acceptFirstMouse` on both frameless platforms lets a click on an unfocused window act instead of only activating it (the floating expand button needs it). Windows drops its default in-window menu bar (`Menu.setApplicationMenu(null)`; macOS keeps the system menu bar at the screen top) — the accelerators it carried (reload, zoom, devtools) are not product surface, and source launches keep F12 as a window-scoped devtools handle. The Windows overlay is solid (the WCO has no transparency), so it starts on the dark window surface and follows the resolved page theme: the sandboxed preload (`src/preload.cjs`) exposes `window.dshDesktop.setThemeColors`, and the web entry's desktop branch reports the color actually visible under the band — the body background composited with any full-viewport layer stacked there (the settings mask) — on load, whenever the theme rewrites the body, and on a 300 ms poll that catches overlay open/close. The shell appends `?shell=desktop` to the loaded URL, and `apps/web/src/main.ts` tags `<html data-shell="desktop">` in response. Desktop-only layout rules keyed on that attribute (appended blocks and small insertions in `ui-sidebar`'s SidebarRoot, `ui-layout`'s AppFrame, `ui-conversation`'s ConversationRoot, and the modal layers — `ui-settings-general`'s SettingsRoot and `ui-primitives`' Modal/OnboardingSurface):

- **Traffic-light clearance** — the sidebar brand row becomes two lines: the collapse/expand toggle pinned at the traffic-light height (line 1), the full-width wordmark below it (line 2).
- **Zero-width collapse** — a collapsed sidebar takes zero width instead of the stock 56 px rail; its vertical menu items are hidden. Plain browsers keep the bordered rail.
- **Persistent floating toggle** — one button, portaled into the frame's overlay layer at one coordinate in both states. A fixed-position escapee of the zero-width column is not reliably carved out of the browser process's cached drag regions (real clicks land on the conversation strip's drag area: single click drags the window, double click zooms it); portaling into the unclipped full-viewport layer restores reliable hit-testing, and one persistent node means collapse/expand swaps no DOM.
- **Window drag regions** — the conversation column's top strip moves the window (the blank-draft hero sheet, or the session header row once a session is open), as does the sidebar brand row; interactive descendants stay no-drag. Chromium routes a click to the window whenever it falls inside a cached drag rectangle that no explicit no-drag element carves out, and an element in a different tree branch (a menu list portaled to `document.body`, a modal layer) cannot carve the strip's own rectangle. Full-viewport modal layers declare `no-drag` for the whole layer while open — the centered panels overlap the header strip's rectangle (the session header row includes the tab bar, so its box reaches ~68 px down — under the panel's close button and header actions). A small portaled menu cannot cover its strips: while any portaled menu is open, `ui-primitives` Menu flags `<html data-portal-menu-open>` (refcounted), and every drag strip yields `no-drag` for the flag's lifetime — without this, the preset-mode menu's rows hanging below the hero input card swallow every click into the window instead of selecting the mode.

Plain browser loads carry no marker and keep the stock layout (`-webkit-app-region` is inert outside Electron). The pre-paint `backgroundColor` is the dark base token; theme following of the window surface is deferred.

## Packaged layout (electron-builder)

`resources/dsh/` carries a self-contained production installation of `@deepseek-ai/dsh`: a `pnpm deploy --legacy --prod` closure, with post-processing steps that `scripts/package.mjs` applies because pnpm's isolated store is not resolvable by the plain-Node runtime and must not reference the source checkout:

1. **Peer-only injection** — packages the closure references only as `peerDependencies` are invisible to pnpm's deploy closure (capability Service Definitions and similar seams), so they are added to the deploy target's `dependencies` for the duration of the deploy and the manifest is restored afterwards.
2. **Top-level flattening** — a relative symlink is added at the root `node_modules` for every package the store keeps in `.pnpm` virtual directories. The dsh profile boot resolves plugin imports with literal-path node_modules walks from the installation anchor, which cannot see through the top-level symlinks into the store; a flat layout makes every closure package resolvable from any anchor.
3. **Link-override materialization** — the workspace's `link:vendor/*` overrides (the rescoped Cordis foundation) are copied into the store and every in-tree link to them is redirected, because pnpm deploy preserves those overrides as links escaping back into the source checkout.
4. **Foreign-link pruning** — any symlink that does not resolve inside the deployment is removed; electron-builder stats every file it copies and fails on a dangling one.

**Official client build required.** Before staging, `scripts/package.mjs` verifies through `scripts/verify-official-build.mjs` that the root build record (`.dsh-build/client-build-environment.json`) carries `DSH_CLIENT_BUILD_PROFILE=official`: a default-profile build embeds no profile, and the packaged GUI would then ship the local "DSH Local Build" mark. Run `pnpm run build:official` from the repository root before packaging.

The main process resolves the bin at `resources/dsh/lib/bin.js` when `app.isPackaged` (plain Node launch — no tsx needed). See the `package` script of this package's `package.json`.

**Process name.** The packaged main executable is `chrome` on both macOS and Windows, so the process list reads identically on either platform (the dsh child runs through the same binary, so it shows the same name). On macOS electron-builder's top-level `executableName` drives *both* the `.app` bundle name and the main executable, so a bare `executableName: chrome` would also ship `chrome.app`; instead the bundle keeps `productName` (`DeepSeek Harness.app`) and `scripts/package.mjs` drives electron-builder through its JS API with an `afterPack` hook that renames only the main executable to `chrome` (and points `CFBundleExecutable` at it) *before* code signing seals the state. Windows scopes the same name under `win.executableName` in `electron-builder.yml`, where it drives only the exe name (`chrome.exe`). Activity Monitor/Task Manager then show `chrome`, while Finder, the Dock, and the About box — and on Windows the Start Menu entry and uninstall display name — keep `DeepSeek Harness`. Dev builds run as `Electron` on both platforms.

To verify a packaged build from a shell, unset `ELECTRON_RUN_AS_NODE` first: with that variable set, the app binary runs as plain Node and exits silently without starting the GUI.

## App icons

`assets/app-icon/mark.svg` is the DeepSeek mark (LobeHub icon set, MIT). `scripts/generate-icons.mjs` renders it into the electron-builder build resources under `build/`: `icon.icns` (824×824 rounded tile on the 1024 canvas, Big Sur icon grid), `icon.ico` (full-bleed square, PNG entries 16–256), and `icon.png` (512 square for Linux) — a white mark on the app's dark base token (#151517) in every variant. Regenerate with `pnpm --filter @deepseek-ai/dsh-desktop run icons`; the `icns` step needs macOS (`iconutil`), so the generated artifacts are committed and cross-platform packaging does not have to rebuild them.

## Upstream sync

The `upstream` remote tracks `deepseek-ai/deepseek-harness` (default branch `master`). Sync with `git fetch upstream && git merge upstream/master`, then run the verify ladder: `pnpm run test:gui` → `DSH_SNAPSHOT=replay pnpm run test:web` → launch this app in dev mode.

This app is additive (`apps/desktop/` only), so merges conflict only where it intentionally touches upstream files — keep that list minimal and mechanical:

| File | Touch | Why |
| --- | --- | --- |
| `pnpm-workspace.yaml` | `allowBuilds`: `electron: true`, `electron-winstaller: false` | pnpm 10+ blocks unlisted build scripts; the Electron binary download is needed, the Windows NSIS tooling is a no-op here |
| `tsconfig.base.json` | two `paths` entries for `dsh-client-ui-directory-picker-{native,browse}` | these client packages lack the explicit entry every host/client-group package needs (upstream bug; without it source launches fail on Node 24) |
| root `package.json` | `desktop:dev`, `desktop:package` scripts | convenience entry points |
| `apps/web/src/main.ts` | `?shell=desktop` marker detection (tags `<html data-shell="desktop">`) + caption-band color reporting to the shell preload | window integration — see above |
| `packages/client/ui-layout/.../AppFrame.tsx` + `.module.css` | zero-width collapsed-sidebar track on desktop; no border seam while collapsed | window integration — see above |
| `packages/client/ui-sidebar/.../SidebarRoot.tsx` + `.module.css` | persistent portaled toggle, two-line brand row, hidden menu items when collapsed; brand row yields `no-drag` while `<html data-portal-menu-open>` holds | window integration — see above |
| `packages/client/ui-sidebar/package.json` | `react-dom` dependency (+ `@types/react-dom`) for the portal import | window integration — see above |
| `packages/client/ui-conversation/.../ConversationRoot.module.css` | appended `data-shell`-keyed block (hero + session-header drag regions); strips yield `no-drag` while `<html data-portal-menu-open>` holds | window integration — see above |
| `packages/client/ui-settings-general/.../SettingsRoot.module.css` | settings panel layer is `no-drag` while open (drag-strip carve-out) | window integration — see above |
| `packages/client/ui-primitives/.../Modal.module.css`, `OnboardingSurface.module.css` | modal + first-run stage layers are `no-drag` while open (same carve-out) | window integration — see above |
| `packages/client/ui-primitives/src/Menu.tsx` + `tests/atoms.client.spec.tsx` | open portaled menu flags `<html data-portal-menu-open>` for its lifetime (refcounted), the drag-strip yield signal | window integration — see above |

If upstream adds the same `paths` entries or scripts independently, drop the local copy on merge. The web-side patches are appended blocks and a few inserted lines; on merge conflict, keep the local version unless upstream ships its own desktop-shell layout.

## Known Limitations and Deferred Work

- The Windows caption-button overlay is solid and tracks the page theme only after the renderer's first report; until then (and if the page never loads) it shows the dark window surface. Each re-color lands one or two frames after the page repaints (cross-process IPC), and a mask's backdrop blur does not enter the sampled color.
- No tray, global shortcuts, or native directory-picker backend yet — those are Phase 2+ surfaces (the picker seam already reserves an Electron-provided `native` backend).
- The child runs on the Node bundled with Electron; a future Electron upgrade must keep that within the repo's `engines` range (`^22.19 || >=24`).
- Windows stale-child reaping relies on `ps`, which is absent there; the pidfile is still written and removed, but reaping is a no-op until a platform check lands.
