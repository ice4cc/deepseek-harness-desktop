# @deepseek-ai/dsh-desktop

Electron desktop shell over the dsh web GUI (Mode A: loopback HTTP). The main process spawns the `dsh` web profile as a child Node process (`web --port 0`, run through Electron's own binary with `ELECTRON_RUN_AS_NODE=1`), waits for the documented readiness line (`dsh web: http://127.0.0.1:<port>`), and loads that loopback URL in one BrowserWindow. The GUI is served by `dsh-host-webserver` bound to 127.0.0.1 only; the shell adds no protocol surface — the page talks to dsh over same-origin HTTP/WebSocket exactly as in a browser, so every web client package (and all slot-based UI customization) works unchanged.

## Run from source

```sh
pnpm run build                                  # builds apps/cli lib + frontend dist
pnpm --filter @deepseek-ai/dsh-desktop run dev  # electron . over the repo checkout
```

The dev layout launches the dsh bin **from source through tsx** (`node --expose-internals --import <tsx> <repo>/apps/cli/src/bin.ts web --port 0` with `TSX_TSCONFIG_PATH=<repo>/tsconfig.json`): the pnpm-isolated checkout cannot serve the repo's bare `@deepseek-ai/*` names to plain Node, so source launches go through tsx's tsconfig-paths resolution — the same contract the keyless web smoke uses. The full environment is passed through, so `DEEPSEEK_API_KEY` (or configured providers) reach the host.

`--expose-internals` is required by the cordis HMR service: it needs Node's internal ESM loader, and under Electron's bundled Node (RUN_AS_NODE mode) the `node-addon-require-builtin` fallback that plain source launches rely on is not guaranteed to load.

## Lifecycle semantics

- Single-instance lock: a second launch focuses the existing window and exits without touching the running child.
- Closing the window terminates the child (SIGTERM, SIGKILL after 5 s) and quits on every platform — deliberately, so closing the app never leaves the agent host running unattended.
- An early child exit shows a dialog with the stderr tail and quits.
- A pidfile at `$DSH_HOME/desktop/dsh-child.pid` reaps a dsh child left behind by a force-killed previous instance; the pid is only killed when its command line still names the dev source entry (`apps/cli/src/bin.ts`) or the packaged bin (`dsh/lib/bin.js`).

## Packaged layout (electron-builder)

`resources/dsh/` carries a self-contained production installation of `@deepseek-ai/dsh`: a `pnpm deploy --legacy --prod` closure, with post-processing steps that `scripts/package.mjs` applies because pnpm's isolated store is not resolvable by the plain-Node runtime and must not reference the source checkout:

1. **Peer-only injection** — packages the closure references only as `peerDependencies` are invisible to pnpm's deploy closure (capability Service Definitions and similar seams), so they are added to the deploy target's `dependencies` for the duration of the deploy and the manifest is restored afterwards.
2. **Top-level flattening** — a relative symlink is added at the root `node_modules` for every package the store keeps in `.pnpm` virtual directories. The dsh profile boot resolves plugin imports with literal-path node_modules walks from the installation anchor, which cannot see through the top-level symlinks into the store; a flat layout makes every closure package resolvable from any anchor.
3. **Link-override materialization** — the workspace's `link:vendor/*` overrides (the rescoped Cordis foundation) are copied into the store and every in-tree link to them is redirected, because pnpm deploy preserves those overrides as links escaping back into the source checkout.
4. **Foreign-link pruning** — any symlink that does not resolve inside the deployment is removed; electron-builder stats every file it copies and fails on a dangling one.

The main process resolves the bin at `resources/dsh/lib/bin.js` when `app.isPackaged` (plain Node launch — no tsx needed). See the `package` script of this package's `package.json`.

To verify a packaged build from a shell, unset `ELECTRON_RUN_AS_NODE` first: with that variable set, the app binary runs as plain Node and exits silently without starting the GUI.

## Upstream sync

The `upstream` remote tracks `deepseek-ai/deepseek-harness` (default branch `master`). Sync with `git fetch upstream && git merge upstream/master`, then run the verify ladder: `pnpm run test:gui` → `DSH_SNAPSHOT=replay pnpm run test:web` → launch this app in dev mode.

This app is additive (`apps/desktop/` only), so merges conflict only where it intentionally touches upstream files — keep that list minimal and mechanical:

| File | Touch | Why |
| --- | --- | --- |
| `pnpm-workspace.yaml` | `allowBuilds`: `electron: true`, `electron-winstaller: false` | pnpm 10+ blocks unlisted build scripts; the Electron binary download is needed, the Windows NSIS tooling is a no-op here |
| `tsconfig.base.json` | two `paths` entries for `dsh-client-ui-directory-picker-{native,browse}` | these client packages lack the explicit entry every host/client-group package needs (upstream bug; without it source launches fail on Node 24) |
| root `package.json` | `desktop:dev`, `desktop:package` scripts | convenience entry points |

If upstream adds the same `paths` entries or scripts independently, drop the local copy on merge.

## Known Limitations and Deferred Work

- No tray, global shortcuts, or native directory-picker backend yet — those are Phase 2+ surfaces (the picker seam already reserves an Electron-provided `native` backend).
- The child runs on the Node bundled with Electron; a future Electron upgrade must keep that within the repo's `engines` range (`^22.19 || >=24`).
- Windows stale-child reaping relies on `ps`, which is absent there; the pidfile is still written and removed, but reaping is a no-op until a platform check lands.
