/**
 * @deepseek-ai/dsh-desktop — sandboxed preload bridge (Mode A desktop shell).
 *
 * Exposes the shell marker plus one capability to the page: reporting the
 * resolved theme colors so the main process can re-color the solid Windows
 * caption-button overlay (the WCO has no transparency and cannot read page
 * CSS). The payload crosses the preload/main wire boundary and is validated in
 * the main process; this bridge only forwards. The marker rides here rather
 * than in the URL because the loaded URL is a one-shot credential exchange —
 * the server's token-to-cookie redirect strips every query parameter, so a
 * `?shell=desktop` parameter would die with it. Plain browsers never load this
 * script, and the `.cjs` extension keeps it CommonJS under the sandboxed-preload
 * rule despite the package's `"type": "module"`.
 * @module @deepseek-ai/dsh-desktop/preload
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  /** Shell marker: its presence alone means the page runs inside this desktop shell. */
  shell: 'desktop',
  /** The platform that owns the window controls (Electron main's process.platform). */
  os: process.platform,
  /**
   * Report the page's resolved theme colors to the main process.
   * @param {{ color: string, symbolColor: string }} colors - computed body background (overlay fill) and text color (caption glyphs).
   */
  setThemeColors: (colors) => {
    ipcRenderer.send('desktop:set-theme-colors', colors)
  },
})
