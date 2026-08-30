// Desktop shell marker regression guard: the loaded URL is a one-shot
// credential exchange (token-to-cookie, 303 to clean `/`), so the desktop
// marker must arrive through the preload bridge — a `?shell=desktop` query
// parameter dies in that redirect and every window drag region with it. This
// spec boots the real composition and pins both sides: an injected bridge tags
// `<html data-shell="desktop" data-os>` after the redirect, and a plain load
// without the bridge keeps the stock layout.
import type { Browser } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

describe('web e2e: desktop shell marker', () => {
  let scaffold: WebScaffold
  let browser: Browser

  beforeAll(async () => {
    scaffold = await launchWebScaffold()
    browser = await chromium.launch()
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('tags the desktop shell through the preload bridge after the token redirect', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    // The sandboxed preload (apps/desktop/src/preload.cjs) exposes exactly this
    // shape; plain Chromium has no preload, so the spec injects it.
    await context.addInitScript(() => {
      (globalThis as Record<string, unknown>).dshDesktop = { shell: 'desktop', os: 'darwin', setThemeColors: () => {} }
    })
    const page = await context.newPage()
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // The token exchange redirected to clean `/` — the marker survived anyway.
    expect(page.url()).toBe(new URL(scaffold.authenticatedUrl).origin + '/')
    const shell = await page.evaluate(() => document.documentElement.getAttribute('data-shell'))
    const os = await page.evaluate(() => document.documentElement.getAttribute('data-os'))
    expect(shell).toBe('desktop')
    expect(os).toBe('darwin')
    // The marker is only meaningful with the desktop rules shipped in the
    // client bundles (drag regions, traffic-light clearance).
    const hasDragRules = await page.evaluate(() =>
      [...document.querySelectorAll('style[data-plugin-css]')]
        .some(style => style.textContent.includes('-webkit-app-region')))
    expect(hasDragRules).toBe(true)
    await context.close()
  })

  it('keeps the stock layout when no bridge is present', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const shell = await page.evaluate(() => document.documentElement.getAttribute('data-shell'))
    const os = await page.evaluate(() => document.documentElement.getAttribute('data-os'))
    expect(shell).toBeNull()
    expect(os).toBeNull()
  })
})
