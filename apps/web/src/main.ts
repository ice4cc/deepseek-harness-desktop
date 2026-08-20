/**
 * Web application entry: thin bootstrap over the shell library. Everything —
 * module-table seeding, the boot page, and the UI-renderer handoff — lives
 * in @deepseek-ai/dsh-client-web; this file only finds the mount point.
 */
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

// Desktop-shell marker (`?shell=desktop`, appended by the Electron shell):
// tags <html> so desktop-only layout rules (traffic-light clearance, window
// drag regions) apply; plain browser loads keep the stock layout.
if (new URLSearchParams(window.location.search).get('shell') === 'desktop') {
  document.documentElement.dataset.shell = 'desktop'
}

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
