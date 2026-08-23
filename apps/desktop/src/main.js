/**
 * @deepseek-ai/dsh-desktop — Electron main process for the desktop shell (Mode A).
 *
 * Spawns the built `dsh` web profile as a child Node process (`--port 0`, OS-assigned,
 * `--no-open`: the default-browser handoff serves terminal users — the GUI of this
 * shell lives in its own window), waits for its readiness line
 * (`dsh web: http://127.0.0.1:<port>` — the documented readiness signal of the
 * web-app bundle), and loads that loopback URL in one BrowserWindow. The GUI is served by dsh-host-webserver bound to 127.0.0.1 only, so
 * this shell adds no protocol surface of its own: the page talks to dsh over
 * same-origin HTTP/WebSocket exactly as it would in a browser.
 *
 * Lifecycle: closing the window terminates the child (SIGTERM, SIGKILL after a grace
 * period) and quits on every platform; an early child exit surfaces its stderr tail in
 * a dialog and quits. A pidfile under `$DSH_HOME/desktop/` reaps a dsh child left
 * behind by a force-killed previous instance.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'

/** Directory containing this file (`<app>/src`). */
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url))

/** Grace between SIGTERM and SIGKILL when shutting down the dsh child. */
const SHUTDOWN_GRACE_MS = 5000

/** Boot budget before the readiness line must appear on stdout. */
const READY_TIMEOUT_MS = 90_000

/** Maximum retained stderr bytes shown in a failure dialog. */
const STDERR_TAIL_BYTES = 8192

/** The dark base token (neutral-bluish-950): pre-paint window surface and the Windows caption-button overlay before the page reports its resolved theme. */
const DARK_SURFACE = '#151517'

/** Dark-theme label-primary (neutral-bluish-50): caption glyph color until the page reports its own. */
const DARK_SYMBOLS = '#fafafa'

// The runtime app name (and with it the userData directory and the
// single-instance lock) must be unique per product: without this, Electron
// falls back to the package.json name, which collides with other builds of
// this shell that share the workspace package name.
app.setName('DeepSeek Harness Desktop')

/**
 * Locate the dsh installation for the dev (repo checkout) and packaged layouts.
 * @returns {{ args: string[], cwd: string, env: Record<string, string>, entry: string }} the Node argument vector (after the executable), working directory, extra environment, and the dsh entry file for the existence check.
 */
function resolveInstall() {
  if (app.isPackaged) {
    // Packaged layout: resources/dsh/ is the `pnpm deploy --prod` output of
    // @deepseek-ai/dsh — its own package.json, lib/bin.js, and a self-contained
    // production node_modules. Bare plugin names resolve through that flat tree,
    // so the built bin runs under plain Node.
    const root = path.join(process.resourcesPath, 'dsh')
    const bin = path.join(root, 'lib', 'bin.js')
    // --no-open: dsh web hands the URL to the system browser by default (a
    // terminal-user convenience); this shell already shows the GUI in-window.
    return { args: ['--expose-internals', bin, 'web', '--port', '0', '--no-open'], cwd: root, env: {}, entry: bin }
  }
  // Dev layout: this file is <repo>/apps/desktop/src/main.js. The source tree
  // boots through tsx exactly like the repo's keyless CLI smoke does: tsconfig
  // paths resolve the bare workspace plugin names that pnpm's isolated
  // node_modules cannot serve from the loader's location.
  const repoRoot = path.resolve(SRC_DIR, '..', '..', '..')
  const tsxEntry = createRequire(path.join(repoRoot, 'package.json')).resolve('tsx')
  const binSource = path.join(repoRoot, 'apps/cli/src/bin.ts')
  // --expose-internals: the cordis HMR service needs Node's internal ESM
  // loader; the desktop child runs Electron's bundled Node, where the
  // node-addon-require-builtin fallback the source launch relies on is not
  // guaranteed to load.
  return {
    // --no-open: same reason as the packaged layout — no system-browser handoff.
    args: ['--expose-internals', '--import', pathToFileURL(tsxEntry).href, binSource, 'web', '--port', '0', '--no-open'],
    cwd: repoRoot,
    env: { TSX_TSCONFIG_PATH: path.join(repoRoot, 'tsconfig.json') },
    entry: binSource,
  }
}

/**
 * Pidfile for the dsh child, beside the harness home's other per-surface state.
 * @returns {string} absolute pidfile path.
 */
function childPidfile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'desktop', 'dsh-child.pid')
}

/**
 * Reap a dsh child left behind by a force-killed previous instance. The pid is only
 * killed when its command line still names the dsh bin — a recycled pid belonging to
 * another process is never touched. Best effort: diagnostics go to the console.
 */
function reapStaleChild() {
  const file = childPidfile()
  let raw
  try {
    raw = readFileSync(file, 'utf8').trim()
  } catch {
    return // no pidfile: nothing to reap
  }
  const pid = Number(raw)
  if (!Number.isInteger(pid) || pid <= 0) {
    rmSync(file, { force: true })
    return
  }
  execFile('ps', ['-p', String(pid), '-o', 'args='], (error, stdout) => {
    if (error !== null) {
      rmSync(file, { force: true }) // process gone: drop the stale record
      return
    }
    // The child's command line names the dev source entry (tsx launch) or the
    // packaged bin; anything else means the pid was recycled — never touch it.
    if (!stdout.includes('apps/cli/src/bin.ts') && !stdout.includes('dsh/lib/bin.js')) return
    try {
      process.kill(pid, 'SIGKILL')
      console.log(`[desktop] reaped stale dsh child ${String(pid)}`)
    } catch (killError) {
      console.warn('[desktop] failed to reap stale dsh child:', killError)
    }
  })
}

/** Record the live child pid so a future start can reap it. */
function writePidfile(pid) {
  const file = childPidfile()
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${String(pid)}\n`)
}

/** Drop the pidfile; a missing file is not an error. */
function removePidfile() {
  rmSync(childPidfile(), { force: true })
}

/**
 * Spawn the dsh web profile and resolve with its loopback URL once the server prints
 * the readiness line. The child runs as plain Node through Electron's own binary
 * (`ELECTRON_RUN_AS_NODE`), so no separate Node runtime is required. On timeout or
 * early exit the promise rejects with the retained stderr tail and the child is killed.
 * @param {{ args: string[], cwd: string, env: Record<string, string>, entry: string }} install - resolved dsh installation.
 * @returns {Promise<{ url: string, child: import('node:child_process').ChildProcess }>} the loopback URL and the running child.
 */
function startDsh(install) {
  return new Promise((resolve, reject) => {
    if (!existsSync(install.entry)) {
      reject(new Error(`dsh entry not found at ${install.entry}; run \`pnpm run build\` from the repository root first`))
      return
    }
    const child = spawn(process.execPath, install.args, {
      cwd: install.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...install.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let settled = false
    let stderrTail = ''
    const timer = setTimeout(() => {
      fail(new Error(`dsh did not become ready within ${String(READY_TIMEOUT_MS / 1000)}s; last output:\n${stderrTail.slice(-STDERR_TAIL_BYTES)}`))
    }, READY_TIMEOUT_MS)

    /** Settle the promise exactly once, killing the child on failure. */
    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(error)
    }

    let buffer = ''
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        const match = /^dsh web: (\S+)/.exec(line)
        if (match !== null && !settled) {
          settled = true
          clearTimeout(timer)
          resolve({ url: match[1], child })
          return
        }
      }
    })
    child.stderr.on('data', (chunk) => {
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-STDERR_TAIL_BYTES * 2)
      process.stderr.write(`[dsh] ${chunk}`)
    })
    child.on('exit', (code) => {
      fail(new Error(`dsh exited before becoming ready (code ${String(code)}); last output:\n${stderrTail.slice(-STDERR_TAIL_BYTES)}`))
    })
    child.on('error', fail)
  })
}

/**
 * Terminate the dsh child: SIGTERM first, SIGKILL after the grace period. Resolves
 * once the child has actually exited (immediately when it is already dead).
 * @param {import('node:child_process').ChildProcess | null} child - the running dsh child.
 * @returns {Promise<void>}
 */
function killChild(child) {
  return new Promise((resolve) => {
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        resolve()
      }
    }
    child.once('exit', finish)
    child.kill('SIGTERM')
    setTimeout(() => {
      // SIGKILL cannot be ignored; the exit event settles the promise.
      if (!done && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }, SHUTDOWN_GRACE_MS)
  })
}

/**
 * Create the single application window loading the dsh loopback URL.
 * @param {string} url - the ready dsh loopback URL.
 * @returns {BrowserWindow}
 */
function createWindow(url) {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    // The dark base token (neutral-bluish-950): avoids a white flash before
    // the first page paint. Theme following is deferred.
    backgroundColor: DARK_SURFACE,
    // Taskbar/window icon on Windows and Linux. macOS takes its Dock icon
    // from the app bundle (build/icon.icns); without this, dev builds on the
    // other platforms would show the default Electron icon.
    ...(process.platform !== 'darwin' ? { icon: path.join(SRC_DIR, '..', 'build', 'icon.png') } : {}),
    // macOS and Windows both hide the OS caption bar so the page's own top
    // strip carries the window (the sidebar brand row and the conversation
    // header carry the desktop-shell layout through `?shell=desktop`): macOS
    // insets the traffic lights; Windows floats only the native min/max/close
    // buttons over that same 44 px band. The overlay is solid — the Windows
    // WCO has no transparency — so it starts on the dark window surface and
    // the preload bridge re-colors it to the resolved page theme (see
    // desktop:set-theme-colors). Linux keeps the stock native frame and menu
    // bar. acceptFirstMouse on both frameless platforms: a click on an
    // unfocused window acts instead of only activating it — required for the
    // floating expand button after the user has been looking elsewhere.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', acceptFirstMouse: true } : {}),
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden', acceptFirstMouse: true, titleBarOverlay: { color: DARK_SURFACE, symbolColor: DARK_SYMBOLS } }
      : {}),
    // The sandboxed preload exposes window.dshDesktop (theme-color reporting
    // for the Windows caption overlay); plain browsers never load it.
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(SRC_DIR, 'preload.cjs') },
  })
  // The SPA never opens its own windows; hand external links to the OS browser.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) void shell.openExternal(target)
    return { action: 'deny' }
  })
  // Windows drops its default menu bar (see whenReady), which takes the View >
  // Toggle Developer Tools accelerator with it; source launches keep F12 as a
  // window-scoped devtools handle instead of registering a global shortcut.
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        event.preventDefault()
        window.webContents.toggleDevTools()
      }
    })
  }
  // The shell marker lets the web page apply desktop-only layout (traffic-light
  // clearance, window drag regions); plain browser loads stay untouched.
  const target = new URL(url)
  target.searchParams.set('shell', 'desktop')
  void window.loadURL(target.toString())
  return window
}

let win = null
/** The running dsh child, once ready. */
let dshChild = null

/** CSS colors the theme bridge may set on the caption overlay: hex or computed rgb()/rgba(). */
const BRIDGE_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$|^rgba?\(\d{1,3}, \d{1,3}, \d{1,3}(, (?:0|1|0?\.\d+))?\)$/

// The page reports its resolved theme colors through the preload bridge so the
// solid Windows caption overlay follows the in-page theme (light/dark/system —
// the WCO cannot read page CSS). The payload crosses the preload/main wire
// boundary, so validate it before applying; non-Windows windows carry no
// overlay and their reports are dropped.
ipcMain.on('desktop:set-theme-colors', (_event, colors) => {
  if (process.platform !== 'win32' || win === null) return
  if (typeof colors !== 'object' || colors === null) return
  const { color, symbolColor } = colors
  if (typeof color !== 'string' || !BRIDGE_COLOR.test(color)) return
  if (typeof symbolColor !== 'string' || !BRIDGE_COLOR.test(symbolColor)) return
  win.setTitleBarOverlay({ color, symbolColor })
})

/** Set as soon as any shutdown path begins; boot must not resurrect a dead app. */
let shuttingDown = false

if (!app.requestSingleInstanceLock()) {
  // A live instance owns the dsh child; this one exits without touching it.
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win === null) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(async () => {
    // Windows would otherwise show Electron's default menu bar inside the
    // window; with the caption bar hidden there is nowhere it belongs, so drop
    // it. macOS keeps its system menu bar at the screen top as standard. The
    // accelerators it carried (reload, zoom, devtools) are not product
    // surface; source launches keep F12 for devtools (see createWindow).
    if (process.platform === 'win32') Menu.setApplicationMenu(null)
    reapStaleChild()
    try {
      const { url, child } = await startDsh(resolveInstall())
      if (shuttingDown) {
        void killChild(child)
        return
      }
      dshChild = child
      writePidfile(child.pid)
      win = createWindow(url)
      // An unrequested exit is a host failure: show what it printed, then quit.
      child.on('exit', () => {
        if (shuttingDown) return
        dialog.showErrorBox('DeepSeek Harness stopped unexpectedly', 'The dsh host process exited. See the app console for its last output.')
        void killChild(null).then(() => app.quit())
      })
    } catch (error) {
      dialog.showErrorBox(
        'DeepSeek Harness failed to start',
        error instanceof Error ? error.message : String(error),
      )
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    // Deliberate on every platform: the window is the app, and closing it must not
    // leave the agent host running unattended.
    shuttingDown = true
    win = null
    void killChild(dshChild).then(() => {
      removePidfile()
      app.quit()
    })
  })

  app.on('quit', () => {
    // Last-resort containment if a shutdown path skipped the ordered teardown.
    if (dshChild !== null && dshChild.exitCode === null && dshChild.signalCode === null) {
      dshChild.kill('SIGKILL')
    }
    removePidfile()
  })
}
