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

/**
 * Feed the Windows caption-button overlay the page's resolved theme colors: it
 * is a solid OS-drawn band that cannot read page CSS, so the renderer reports
 * in. Boot has set the body palette before this entry runs; every later change
 * (settings selection, system-scheme flip, reconnect refetch) rewrites body
 * attributes or inline tokens, which the observer sees and re-reports. The
 * fill is the color actually visible under the band: full-viewport layers such
 * as the settings mask darken it without touching body, so a poll re-samples
 * between attribute changes and skips unchanged reports.
 */
function reportDesktopThemeColors(): void {
  const bridge = window.dshDesktop
  if (bridge === undefined) return
  let lastReported = ''
  const report = (): void => {
    const computed = getComputedStyle(document.body)
    const color = sampleCaptionFill() ?? computed.backgroundColor
    const symbolColor = computed.color
    const key = `${color}\u0000${symbolColor}`
    if (key === lastReported) return
    lastReported = key
    bridge.setThemeColors({ color, symbolColor })
  }
  report()
  new MutationObserver(report).observe(document.body, { attributes: true })
  // Stylesheet loads resolve the token variables without touching body; re-read once resources settle.
  window.addEventListener('load', report)
  // Overlay open/close never touches body; poll the composited band color and re-report on change.
  window.setInterval(report, 300)
}

/** Sample point inside the Windows caption-button band, clear of page header controls. */
const CAPTION_SAMPLE_X_OFFSET = 12
const CAPTION_SAMPLE_Y = 20

/**
 * Composite what the page would paint under the caption band: every element
 * stacked at the sample point contributes its background top-down (source-over),
 * finishing over the body's own. Returns null when no layer covers the base —
 * where the body color is already the answer.
 */
function sampleCaptionFill(): string | null {
  const x = window.innerWidth - CAPTION_SAMPLE_X_OFFSET
  if (x <= 0 || CAPTION_SAMPLE_Y >= window.innerHeight) return null
  let acc: [number, number, number, number] | null = null
  for (const el of document.elementsFromPoint(x, CAPTION_SAMPLE_Y)) {
    if (el === document.body) break
    const layer = parseRgb(getComputedStyle(el).backgroundColor)
    if (layer === null || layer[3] === 0) continue
    // The list is top-down: each new element sits BELOW the accumulated stack.
    acc = acc === null ? layer : sourceOver(acc, layer)
    if (acc[3] >= 1) break
  }
  if (acc === null) return null
  const base = parseRgb(getComputedStyle(document.body).backgroundColor) ?? [255, 255, 255, 1]
  return toCssColor(sourceOver(acc, base))
}

/** Serialize channels for the main-process color validator (rgb() when opaque). */
function toCssColor([r, g, b, a]: [number, number, number, number]): string {
  const rgb = `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`
  return a >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${Number(a.toFixed(3))})`
}

const RGB_COMPUTED = /^rgba?\(\s*(\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})(?:,\s*([0-9.]+))?\s*\)$/

/** Parse a computed rgb()/rgba() color into channels; null for any other serialization. */
function parseRgb(value: string): [number, number, number, number] | null {
  const m = RGB_COMPUTED.exec(value)
  if (m === null) return null
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
}

/** Alpha-composite src over dst (null = transparent), standard source-over. */
function sourceOver(
  src: [number, number, number, number],
  dst: [number, number, number, number] | null,
): [number, number, number, number] {
  const d: [number, number, number, number] = dst ?? [0, 0, 0, 0]
  const a = src[3] + d[3] * (1 - src[3])
  if (a === 0) return [0, 0, 0, 0]
  const mix = (s: number, t: number): number => (s * src[3] + t * d[3] * (1 - src[3])) / a
  return [mix(src[0], d[0]), mix(src[1], d[1]), mix(src[2], d[2]), a]
}

// Desktop-shell marker (`?shell=desktop`, appended by the Electron shell):
// tags <html> so desktop-only layout rules (traffic-light clearance, window
// drag regions) apply; plain browser loads keep the stock layout. Runs after
// every module definition below it: the reporter reads module-level constants
// that a top-of-file call would still find in the temporal dead zone.
if (new URLSearchParams(window.location.search).get('shell') === 'desktop') {
  document.documentElement.dataset.shell = 'desktop'
  reportDesktopThemeColors()
}

const el = document.getElementById('root')
if (el === null) throw new Error('web app: missing #root')
void new AppWebEntry(el).run()
