/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * module-table seeding, the boot page, and the UI-renderer handoff — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

/** The Electron shell's preload bridge (apps/desktop/src/preload.cjs); absent in plain browsers. */
interface DesktopShellBridge {
  /** Re-color the Windows caption-button overlay to the resolved page theme.
   * @param colors - computed body background (overlay fill) and text color (caption glyphs). */
  setThemeColors(colors: { color: string; symbolColor: string }): void
}

declare global {
  interface Window {
    dshDesktop?: DesktopShellBridge
  }
}

// Desktop-shell marker (`?shell=desktop`, appended by the Electron shell):
// tags <html> so desktop-only layout rules (traffic-light clearance, window
// drag regions) apply; plain browser loads keep the stock layout.
if (new URLSearchParams(window.location.search).get('shell') === 'desktop') {
  document.documentElement.dataset.shell = 'desktop'
  reportDesktopThemeColors()
}

/**
 * Feed the Windows caption-button overlay the page's resolved theme colors: it
 * is a solid OS-drawn band that cannot read page CSS, so the renderer reports
 * in. Boot has set the body palette before this entry runs; every later change
 * (settings selection, system-scheme flip, reconnect refetch) rewrites body
 * attributes or inline tokens, which the observer sees and re-reports.
 */
function reportDesktopThemeColors(): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) return
  const report = (): void => {
    const computed = getComputedStyle(document.body)
    bridge.setThemeColors({ color: computed.backgroundColor, symbolColor: computed.color })
  }
  report()
  new MutationObserver(report).observe(document.body, { attributes: true })
  // Stylesheet loads resolve the token variables without touching body; re-read once resources settle.
  window.addEventListener('load', report)
}

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
