// @vitest-environment jsdom
/**
 * ChangesTab behavior: the path helpers (cwd resolution and relativization),
 * the empty state, row stats, diff expansion through DiffBlock, and opening
 * a file from its path. Feeds props directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FileChangesProjection } from '@deepseek-ai/dsh-file-changes/client'
import { ChangesTab, relativeToCwd, resolveAgainstCwd } from '../src/client/ChangesTab.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

afterEach(() => { cleanup() })

describe('resolveAgainstCwd / relativeToCwd', () => {
  it('keeps absolute paths and resolves cwd-relative ones for reads', () => {
    expect(resolveAgainstCwd('/w/proj', '/abs/x.md')).toBe('/abs/x.md')
    expect(resolveAgainstCwd('/w/proj', 'src/x.md')).toBe('/w/proj/src/x.md')
    expect(resolveAgainstCwd(undefined, 'src/x.md')).toBe('src/x.md')
  })

  it('relativizes paths under the cwd and shows the rest verbatim', () => {
    expect(relativeToCwd('/w/proj', '/w/proj/src/x.md')).toBe('src/x.md')
    expect(relativeToCwd('/w/proj', '/elsewhere/x.md')).toBe('/elsewhere/x.md')
    expect(relativeToCwd(undefined, '/w/proj/src/x.md')).toBe('/w/proj/src/x.md')
    expect(relativeToCwd('/w/proj', 'src/x.md')).toBe('src/x.md')
  })
})

const CHANGES: FileChangesProjection = {
  files: [
    {
      path: '/w/proj/src/a.ts', edits: 2, added: 5, removed: 1, lastAt: 2000,
      lastDiff: [{ path: '/w/proj/src/a.ts', oldText: 'old line\n', newText: 'new line\n' }],
    },
    { path: '/w/proj/b.md', edits: 1, added: 3, removed: 0, lastAt: 1000, lastDiff: null },
  ],
}

describe('ChangesTab', () => {
  it('shows the empty state without a projection or with no files', () => {
    const { rerender } = render(<ChangesTab changes={undefined} cwd="/w/proj" onOpenFile={vi.fn()} t={t} />)
    expect(screen.getByText(/No file changes/)).toBeTruthy()
    rerender(<ChangesTab changes={{ files: [] }} cwd="/w/proj" onOpenFile={vi.fn()} t={t} />)
    expect(screen.getByText(/No file changes/)).toBeTruthy()
  })

  it('lists rows newest-first with relative paths and stats', () => {
    const { container } = render(<ChangesTab changes={CHANGES} cwd="/w/proj" onOpenFile={vi.fn()} t={t} />)
    const rows = container.querySelectorAll('[role="listitem"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('src/a.ts')
    expect(rows[0]!.textContent).toContain('+5')
    expect(rows[0]!.textContent).toContain('−1')
    expect(rows[0]!.textContent).toContain('×2')
    expect(rows[1]!.textContent).toContain('b.md')
  })

  it('expands a row to its last diff and collapses again', () => {
    const { container } = render(<ChangesTab changes={CHANGES} cwd="/w/proj" onOpenFile={vi.fn()} t={t} />)
    const chevrons = container.querySelectorAll('[aria-expanded]') as NodeListOf<HTMLButtonElement>
    expect(chevrons[0]!).toBeTruthy()
    expect(chevrons[0]!.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(chevrons[0]!)
    // DiffBlock renders the added line with its marker.
    expect(container.textContent).toContain('new line')
    expect(chevrons[0]!.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(chevrons[0]!)
    expect(container.textContent).not.toContain('new line')
  })

  it('expands a row with a null lastDiff to an empty body', () => {
    const { container } = render(<ChangesTab changes={CHANGES} cwd="/w/proj" onOpenFile={vi.fn()} t={t} />)
    const chevrons = container.querySelectorAll('[aria-expanded]') as NodeListOf<HTMLButtonElement>
    // Only the chevron glyph flips; a null lastDiff adds no diff content.
    expect(container.textContent).not.toContain('new line')
    fireEvent.click(chevrons[1]!)
    expect(chevrons[1]!.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).not.toContain('new line')
  })

  it('opens the resolved absolute path when a row path is clicked', () => {
    const onOpenFile = vi.fn()
    render(<ChangesTab changes={CHANGES} cwd="/w/proj" onOpenFile={onOpenFile} t={t} />)
    fireEvent.click(screen.getByText('src/a.ts'))
    expect(onOpenFile).toHaveBeenCalledWith('/w/proj/src/a.ts')
  })

  it('opens relative stored paths resolved against the cwd', () => {
    const onOpenFile = vi.fn()
    render(
      <ChangesTab
        changes={{ files: [{ path: 'notes/x.md', edits: 1, added: 1, removed: 0, lastAt: 5, lastDiff: null }] }}
        cwd="/w/proj" onOpenFile={onOpenFile} t={t}
      />,
    )
    fireEvent.click(screen.getByText('notes/x.md'))
    expect(onOpenFile).toHaveBeenCalledWith('/w/proj/notes/x.md')
  })
})
