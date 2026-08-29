// @vitest-environment jsdom
/**
 * DocView presentation behavior: loading and error chrome, the Markdown
 * rendered/source toggle, the sandboxed HTML frame (no script), and the
 * editable CodeMirror body for code tabs. Feeds props directly.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocTab } from '../src/client/store.ts'
import { DocView } from '../src/client/views.tsx'
import type { CodeTabControls } from '../src/client/CodeTab.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

// The save/freshness callbacks are irrelevant to these presentation asserts; a
// stub keeps the code-tab render path (CodeTab) satisfiable.
const controls: CodeTabControls = {
  readFile: async () => ({ ok: false, code: 'file-unwritable' }),
  saveFile: async () => ({ ok: false, code: 'file-unwritable' }),
  setDirty: () => {},
  setSaving: () => {},
  saveSucceeded: () => {},
  saveFailed: () => {},
  clearWriteError: () => {},
}

afterEach(() => { cleanup() })

function mdTab(content: string): DocTab {
  return { path: '/a/doc.md', title: 'doc.md', kind: 'markdown', content, loading: false, dirty: false, saving: false }
}

describe('DocView', () => {
  it('shows the loading state while the read is in flight', () => {
    render(<DocView tab={{ path: '/a/x.ts', title: 'x.ts', kind: 'code', loading: true, dirty: false, saving: false }} t={t} controls={controls} />)
    expect(screen.getByText('Reading…')).toBeTruthy()
  })

  it('shows the error state with the wire code when the read failed', () => {
    render(<DocView tab={{ path: '/a/x.ts', title: 'x.ts', kind: 'code', loading: false, error: 'file-too-large', dirty: false, saving: false }} t={t} controls={controls} />)
    expect(screen.getByText(/Could not read this file/)).toBeTruthy()
    expect(screen.getByText(/file-too-large/)).toBeTruthy()
  })

  it('renders markdown by default and toggles to the raw source', () => {
    const { container } = render(<DocView tab={mdTab('# Title\n\n**bold**')} t={t} controls={controls} />)
    expect(container.querySelector('h1')?.textContent).toBe('Title')
    expect(container.querySelector('strong')?.textContent).toBe('bold')

    fireEvent.click(screen.getByRole('button', { name: 'Source' }))
    const pre = container.querySelector('pre')!
    expect(pre.textContent).toBe('# Title\n\n**bold**')
    expect(container.querySelector('h1')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }))
    expect(container.querySelector('h1')?.textContent).toBe('Title')
  })

  it('renders HTML in a scriptless sandboxed frame carrying the document', () => {
    const doc = '<html><body><p>hi</p></body></html>'
    const { container } = render(<DocView tab={{ path: '/a/p.html', title: 'p.html', kind: 'html', content: doc, loading: false, dirty: false, saving: false }} t={t} controls={controls} />)
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toBe(doc)
    // No toggle for HTML tabs.
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull()
  })

  it('mounts an editable CodeMirror view for code tabs carrying the file text', () => {
    const { container } = render(
      <DocView tab={{ path: '/a/x.ts', title: 'x.ts', kind: 'code', language: 'ts', content: 'let n = 1 // c', loading: false, dirty: false, saving: false }} t={t} controls={controls} />,
    )
    expect(container.querySelector('.cm-editor')).toBeTruthy()
    // The editor's content pane holds the document text (gutter numbers live outside it).
    const content = container.querySelector('.cm-content')!
    expect(content.textContent).toContain('let n = 1 // c')
    // Code tabs are editable: CodeMirror exposes a contenteditable surface.
    expect(content.getAttribute('contenteditable')).toBe('true')
  })

  it('mounts an editable CodeMirror view for extension-less code as plain text', () => {
    const { container } = render(
      <DocView tab={{ path: '/a/Makefile', title: 'Makefile', kind: 'code', content: 'all:\n\techo hi', loading: false, dirty: false, saving: false }} t={t} controls={controls} />,
    )
    expect(container.querySelector('.cm-editor')).toBeTruthy()
    const content = container.querySelector('.cm-content')!
    expect(content.textContent).toContain('echo hi')
  })

  it('treats an empty loaded file as present content, not loading', () => {
    render(<DocView tab={mdTab('')} t={t} controls={controls} />)
    expect(screen.queryByText('Reading…')).toBeNull()
  })

  it('mounts an empty CodeMirror view for a settled code tab without content', () => {
    const { container } = render(
      <DocView tab={{ path: '/a/x.ts', title: 'x.ts', kind: 'code', loading: false, dirty: false, saving: false }} t={t} controls={controls} />,
    )
    expect(screen.queryByText('Reading…')).toBeNull()
    expect(container.querySelector('.cm-editor')).toBeTruthy()
  })

  it('shows the conflict banner with its actions when a save went stale', () => {
    const { container } = render(
      <DocView tab={{ path: '/a/x.ts', title: 'x.ts', kind: 'code', language: 'ts', content: 'let n = 1', loading: false, dirty: true, saving: false, writeError: 'file-stale-version' }} t={t} controls={controls} />,
    )
    expect(screen.getByText('This file was modified on disk')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overwrite' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    // The editor still renders beneath the banner.
    expect(container.querySelector('.cm-editor')).toBeTruthy()
  })

  it('shows a plain save error (no banner) for a non-conflict failure', () => {
    render(
      <DocView tab={{ path: '/a/x.ts', title: 'x.ts', kind: 'code', language: 'ts', content: 'let n = 1', loading: false, dirty: true, saving: false, writeError: 'file-unwritable' }} t={t} controls={controls} />,
    )
    expect(screen.getByText(/Save failed/)).toBeTruthy()
    // No conflict banner for a hard failure.
    expect(screen.queryByText('This file was modified on disk')).toBeNull()
  })
})
