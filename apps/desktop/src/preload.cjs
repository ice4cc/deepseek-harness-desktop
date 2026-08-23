/**
 * @deepseek-ai/dsh-desktop — sandboxed preload bridge (Mode A desktop shell).
 *
 * Exposes exactly one capability to the page: reporting the resolved theme
 * colors so the main process can re-color the solid Windows caption-button
 * overlay (the WCO has no transparency and cannot read page CSS). The payload
 * crosses the preload/main wire boundary and is validated in the main process;
 * this bridge only forwards. Plain browsers never load this script, and the
 * `.cjs` extension keeps it CommonJS under the sandboxed-preload rule despite
 * the package's `"type": "module"`.
 * @module @deepseek-ai/dsh-desktop/preload
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dshDesktop', {
  /**
   * Report the page's resolved theme colors to the main process.
   * @param {{ color: string, symbolColor: string }} colors - computed body background (overlay fill) and text color (caption glyphs).
   */
  setThemeColors: (colors) => {
    ipcRenderer.send('desktop:set-theme-colors', colors)
  },
})
