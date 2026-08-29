// Web e2e scenario: the document panel's CodeMirror editing surface — open a
// produced file, edit it in the editor, and persist with the save shortcut
// through the real host write (version-guarded), asserting the on-disk change
// and the baseline refresh (the dirty marker clears). Cold-seeds one successful
// write (zero model calls); the edited bytes land on a real temp file under the
// scaffold workspace, so the panel's read and save ride the live carrier.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { CallId, createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'doc-panel-edit-web-e2e'
const FILE_NAME = 'doc-panel-edit.txt'
const MARKER = 'EDITED_BY_E2E'
// The save shortcut is platform-bound: Cmd on macOS, Ctrl elsewhere.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

/** One settled turn whose single successful write produces the file to edit. */
function editFixture(): string {
  const session = Session.create(SessionId('doc-panel-edit-source'))
  const origin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Create the note file.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: 'Doc panel edit', messageSeqs: [user.seq], source: { kind: 'fallback' } })
  session.append('step/start', { turn: 1, step: 1 })
  const callId = CallId('doc-panel-edit-write')
  const args = JSON.stringify({ file_path: FILE_NAME, content: 'line one\n' })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'tool-call', id: callId, name: 'write', arguments: args }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  const source = session.append('tool/call', { turn: 1, step: 1, callId, name: 'write', arguments: args })
  session.append('tool/result', {
    turn: 1,
    step: 1,
    message: createToolResultMessage({
      callId, content: [{ type: 'text', text: `Created ${FILE_NAME}` }], isError: false,
    }),
  }, { surfaceOp: 'append', sourceEventSeqs: [source.seq] })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  return [
    JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 0, cwd: '{{cwd}}' }),
    ...session.events.map(event => JSON.stringify({ ...event, time: origin + event.seq * 1_000 })),
    '',
  ].join('\n')
}

describe('web e2e: document panel CodeMirror edit and save', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let filePath: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // The produced file must exist on disk for the panel's real read to serve it.
    filePath = join(scaffold.workspaceCwd, FILE_NAME)
    await writeFile(filePath, 'line one\n')
    await seedSession(scaffold, editFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it.skipIf(MODE === 'record')('opens a produced file, edits it in CodeMirror, and persists with the save shortcut', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-doc-panel-edit'))
    // Open the seeded session: the sidebar tree leads with the group header.
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()

    // Expand the document panel (collapsed by default exposes the reopen button).
    const expand = page.getByRole('button', { name: 'Open document panel' })
    if (await expand.count() > 0) await expand.click()
    const panel = page.locator('section[aria-label="Documents"]')
    await panel.waitFor({ timeout: 15_000 })

    // Open the produced file from the changes tab.
    const row = panel.getByRole('button', { name: FILE_NAME })
    await row.waitFor({ timeout: 15_000 })
    await row.click()

    // The code tab mounts an editable CodeMirror carrying the file text.
    const content = panel.locator('.cm-content')
    await content.waitFor({ timeout: 15_000 })
    expect(await content.textContent()).toContain('line one')

    // Edit in the editor: replace the document with a marked revision.
    await content.click()
    await page.keyboard.press(`${MOD}+a`)
    await page.keyboard.type(`line one\n${MARKER}`)
    // The tab is now dirty (the marker rides the title).
    const fileTab = panel.getByRole('tab', { name: new RegExp(FILE_NAME) })
    await expect.poll(async () => (await fileTab.textContent()) ?? '', { timeout: 10_000 }).toContain('●')

    // Persist with the save shortcut; the guarded write lands on disk.
    await page.keyboard.press(`${MOD}+s`)
    await expect.poll(async () => (await readFile(filePath, 'utf8')).includes(MARKER), { timeout: 15_000 }).toBe(true)

    // Baseline refresh: the successful save cleared the dirty marker.
    await expect.poll(async () => (await fileTab.textContent()) ?? '', { timeout: 10_000 }).not.toContain('●')

    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)
})
