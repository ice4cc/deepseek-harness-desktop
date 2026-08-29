// @vitest-environment jsdom
/**
 * DocPanelRoot behavior over a driven fixture runtime: the collapsed reopen
 * button (portaled into the frame's overlay layer), the expanded column,
 * load-on-open (one read per tab, deduped), and the auto-follow effect
 * (baseline on session switch, follow only strictly newer touches, gated by
 * the autoFollow flag). The real store engine backs the useStore seat; the
 * sessions fixture is a plain mutable object re-read on rerender; the frame's
 * owner share (collapsed) is driven per render.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocPanelRootComponentProps } from '../src/client/contract/slots.ts'
import { DocPanelRoot } from '../src/client/DocPanelRoot.tsx'
import { createDocPanelStore, type DocPanelState } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

afterEach(() => { cleanup() })

/** The fixture fills only the fields a test asserts on. */
interface FixtureFile {
  path: string
  lastAt: number
  edits?: number
  added?: number
  removed?: number
  lastDiff?: unknown
}

interface SessionsFixture {
  current: string | undefined
  byId: Record<string, { cwd?: string; projectionValues?: { fileChanges?: { files: FixtureFile[] } } }>
}

function mount(fixture: SessionsFixture) {
  const engine = createDocPanelStore().create()
  const readFile = vi.fn()
  const saveFile = vi.fn()
  const openPanel = vi.fn()
  const closePanel = vi.fn()
  // The frame's owner share, driven per render (AppFrame decides it from the
  // layout store in production).
  const owner = { collapsed: true }
  // The overlay layer the reopen button portals into (AppFrame renders it).
  // querySelector resolves the FIRST match, so stale layers from earlier tests
  // must go before this test's layer exists.
  document.querySelectorAll('[data-shell-overlay]').forEach((el) => { el.remove() })
  const overlayLayer = document.createElement('div')
  overlayLayer.setAttribute('data-shell-overlay', '')
  document.body.appendChild(overlayLayer)
  const useStore: SnapshotSelectorHook<DocPanelState> = selector =>
    useSyncExternalStore(listener => engine.store.subscribe(listener), () => selector(engine.store.getSnapshot()))
  const useSessions = (selector: (s: SessionsFixture) => unknown): unknown => selector(fixture)
  // A fresh element per render: rerender() with the same reference would be a
  // no-op for React, and an argument-less rerender unmounts the tree.
  const element = () => (
    <DocPanelRoot
      collapsed={owner.collapsed}
      useStore={useStore} useSessions={useSessions as DocPanelRootComponentProps['useSessions']}
      useWorkspaces={() => { throw new Error('unused') }}
      actions={engine.actions} readFile={readFile} saveFile={saveFile} openPanel={openPanel} closePanel={closePanel} t={t}
    />
  )
  const view = render(element())
  return {
    engine, readFile, saveFile, openPanel, closePanel, fixture, view, owner, overlayLayer,
    rerender: () => { view.rerender(element()) },
  }
}

describe('DocPanelRoot', () => {
  it('renders the collapsed reopen button in the overlay layer and opens on click', () => {
    const m = mount({ current: 's1', byId: {} })
    const btn = screen.getByRole('button', { name: 'Open document panel' })
    expect(m.overlayLayer.contains(btn)).toBe(true)
    fireEvent.click(btn)
    expect(m.openPanel).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when collapsed and no overlay layer exists yet', () => {
    const m = mount({ current: 's1', byId: {} })
    m.overlayLayer.remove()
    act(() => { m.rerender() })
    expect(m.view.container.innerHTML).toBe('')
  })

  it('shows the changes empty state when expanded with no projection', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.owner.collapsed = false; m.rerender() })
    expect(screen.getByText(/No file changes/)).toBeTruthy()
  })

  it('reads each open tab once on mount and does not re-read after the content lands', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.engine.actions.openTab('s1', '/a/one.md') })
    expect(m.readFile).toHaveBeenCalledTimes(1)
    expect(m.readFile).toHaveBeenCalledWith('/a/one.md')

    // Re-rendering (e.g. a sessions change) must not re-read an in-flight tab…
    act(() => { m.rerender() })
    expect(m.readFile).toHaveBeenCalledTimes(1)

    // …and once the content lands, no further reads.
    act(() => { m.engine.actions.setTabContent('/a/one.md', '# hi\n') })
    act(() => { m.rerender() })
    expect(m.readFile).toHaveBeenCalledTimes(1)
  })

  it('dedupes reads per path across sessions (the content cache is global)', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.engine.actions.openTab('s1', '/a/one.md') })
    expect(m.readFile).toHaveBeenCalledTimes(1)

    // A second session opens the same path while the first read is in
    // flight: the per-path dedupe holds, and once the content lands both
    // sessions' tabs are served from the shared cache — one read total.
    act(() => { m.engine.actions.openTab('s2', '/a/one.md') })
    expect(m.readFile).toHaveBeenCalledTimes(1)
    act(() => { m.engine.actions.setTabContent('/a/one.md', '# hi\n') })
    act(() => {
      m.fixture.current = 's2'
      m.rerender()
    })
    expect(m.readFile).toHaveBeenCalledTimes(1)
  })

  it('baselines existing changes on mount without following them', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w', projectionValues: { fileChanges: { files: [{ path: '/w/a.md', lastAt: 100 }] } } } },
    })
    expect(m.readFile).not.toHaveBeenCalled()
    // A baseline-only session never touches the store: no tab set is minted.
    expect(m.engine.store.getSnapshot().sessions.s1).toBeUndefined()
  })

  it('follows a strictly newer touch: opens the tab and opens the panel column', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w', projectionValues: { fileChanges: { files: [{ path: '/w/a.md', lastAt: 100 }] } } } },
    })

    const next = { files: [{ path: '/w/a.md', lastAt: 200 }] }
    act(() => {
      m.fixture.byId.s1!.projectionValues!.fileChanges = { files: next.files }
      m.rerender()
    })
    const snap = m.engine.store.getSnapshot()
    expect(snap.sessions.s1!.tabPaths).toEqual(['/w/a.md'])
    expect(m.openPanel).toHaveBeenCalledTimes(1)
    expect(m.readFile).toHaveBeenCalledWith('/w/a.md')
  })

  it('does not follow an unchanged or older touch', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w', projectionValues: { fileChanges: { files: [{ path: '/w/a.md', lastAt: 200 }] } } } },
    })
    act(() => { m.rerender() })
    expect(m.engine.store.getSnapshot().sessions.s1).toBeUndefined()

    const older = { files: [{ path: '/w/a.md', lastAt: 100 }] }
    act(() => {
      m.fixture.byId.s1!.projectionValues!.fileChanges = older
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().sessions.s1).toBeUndefined()
  })

  it('re-baselines on session switch (the new session\'s existing changes do not flood)', () => {
    const m = mount({
      current: 's1',
      byId: {
        s1: { projectionValues: { fileChanges: { files: [{ path: '/w/a.md', lastAt: 100 }] } } },
        s2: { projectionValues: { fileChanges: { files: [{ path: '/v/b.md', lastAt: 999 }] } } },
      },
    })
    act(() => {
      m.fixture.current = 's2'
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().sessions.s2).toBeUndefined()

    // A newer touch in s2 follows.
    act(() => {
      m.fixture.byId.s2!.projectionValues!.fileChanges = { files: [{ path: '/v/b.md', lastAt: 1000 }] }
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().sessions.s2?.tabPaths).toEqual(['/v/b.md'])
  })

  it('resolves cwd-relative followed paths against the session cwd', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w/proj', projectionValues: { fileChanges: { files: [{ path: 'src/a.ts', lastAt: 100 }] } } } },
    })
    act(() => {
      m.fixture.byId.s1!.projectionValues!.fileChanges = { files: [{ path: 'src/a.ts', lastAt: 200 }] }
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual(['/w/proj/src/a.ts'])
  })

  it('stops following while autoFollow is off (and resumes when re-enabled)', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w', projectionValues: { fileChanges: { files: [{ path: '/w/a.md', lastAt: 100 }] } } } },
    })
    act(() => { m.engine.actions.setAutoFollow(false) })

    act(() => {
      m.fixture.byId.s1!.projectionValues!.fileChanges = { files: [{ path: '/w/a.md', lastAt: 300 }] }
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().sessions.s1).toBeUndefined()

    // Re-enabling re-baselines through the same seen map: the 300 touch is
    // still unseen, so it follows on the next render.
    act(() => { m.engine.actions.setAutoFollow(true) })
    act(() => { m.rerender() })
    expect(m.engine.store.getSnapshot().sessions.s1?.tabPaths).toEqual(['/w/a.md'])
  })

  it('toggles auto-follow from the header region control', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.owner.collapsed = false; m.rerender() })
    // The spec drives t() with the en dictionary; the tooltip rides the title.
    const follow = screen.getByRole('button', { name: 'Follow' })
    expect(m.engine.store.getSnapshot().autoFollow).toBe(true)
    fireEvent.click(follow)
    expect(m.engine.store.getSnapshot().autoFollow).toBe(false)
  })

  it('switches the active view between changes and an open file tab', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => {
      m.owner.collapsed = false
      m.engine.actions.openTab('s1', '/a/one.md')
      m.engine.actions.setTabContent('/a/one.md', '# Hello\n')
      m.rerender()
    })
    // The active file tab renders its markdown.
    expect(m.view.container.querySelector('h1')?.textContent).toBe('Hello')

    fireEvent.click(screen.getByRole('tab', { name: /Changes/ }))
    expect(m.view.container.querySelector('h1')).toBeNull()
    expect(screen.getByText(/No file changes/)).toBeTruthy()
  })

  it('closes the column from the header and reopens from the portal button', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.owner.collapsed = false; m.rerender() })
    fireEvent.click(screen.getByRole('button', { name: /Collapse/ }))
    expect(m.closePanel).toHaveBeenCalledTimes(1)

    // The frame collapses the column (owner share flips back): the reopen
    // button returns to the overlay layer.
    act(() => { m.owner.collapsed = true; m.rerender() })
    const btn = screen.getByRole('button', { name: 'Open document panel' })
    expect(m.overlayLayer.contains(btn)).toBe(true)
    fireEvent.click(btn)
    expect(m.openPanel).toHaveBeenCalledTimes(1)
  })

  it('opens a file from the changes tab and closes it via its close button', () => {
    const m = mount({
      current: 's1',
      byId: {
        s1: {
          cwd: '/w',
          projectionValues: { fileChanges: { files: [{ path: '/w/a.md', edits: 2, added: 3, removed: 1, lastAt: 5, lastDiff: null }] } },
        },
      },
    })
    act(() => { m.owner.collapsed = false; m.rerender() })
    // The row shows the cwd-relative path; the raw path rides the title.
    const row = screen.getByRole('button', { name: 'a.md' })
    expect(row.getAttribute('title')).toBe('/w/a.md')
    fireEvent.click(row)
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual(['/w/a.md'])
    expect(m.readFile).toHaveBeenCalledWith('/w/a.md')

    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual([])
  })

  it('shows the empty changes view without a current session and ignores activation', () => {
    const m = mount({ current: undefined, byId: {} })
    act(() => { m.owner.collapsed = false; m.rerender() })
    expect(screen.getByText(/No file changes/)).toBeTruthy()
    // No session: activating the changes tab is a no-op.
    fireEvent.click(screen.getByRole('tab', { name: /Changes/ }))
    expect(m.engine.store.getSnapshot().sessions).toEqual({})
  })

  it('asks before closing a dirty tab and discards only on confirm', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.owner.collapsed = false; m.rerender() })
    act(() => {
      m.engine.actions.openTab('s1', '/a/x.ts')
      m.engine.actions.setTabContent('/a/x.ts', 'let n = 1\n')
      m.engine.actions.setDirty('/a/x.ts', true)
      m.rerender()
    })
    // Closing a dirty tab raises the discard guard instead of closing.
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual(['/a/x.ts'])
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy()

    // Cancel keeps the tab and its unsaved state.
    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!)
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual(['/a/x.ts'])
    expect(m.engine.store.getSnapshot().tabs['/a/x.ts']!.dirty).toBe(true)

    // Re-raising the guard and confirming discards the tab.
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard and close' }))
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual([])
  })

  it('closes a clean tab directly without the discard guard', () => {
    const m = mount({ current: 's1', byId: {} })
    act(() => { m.owner.collapsed = false; m.rerender() })
    act(() => {
      m.engine.actions.openTab('s1', '/a/x.ts')
      m.engine.actions.setTabContent('/a/x.ts', 'let n = 1\n')
      m.rerender()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(m.engine.store.getSnapshot().sessions.s1!.tabPaths).toEqual([])
    expect(screen.queryByText(/Unsaved changes/)).toBeNull()
  })

  it('raises the conflict banner when a dirty open tab changes on disk', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w', projectionValues: { fileChanges: { files: [{ path: '/w/a.ts', lastAt: 100 }] } } } },
    })
    act(() => {
      m.engine.actions.openTab('s1', '/w/a.ts')
      m.engine.actions.setTabContent('/w/a.ts', 'let n = 1\n')
      m.engine.actions.setDirty('/w/a.ts', true)
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().tabs['/w/a.ts']!.writeError).toBeUndefined()
    // A newer touch on the same (dirty) file raises the conflict, not a clobber.
    act(() => {
      m.fixture.byId.s1!.projectionValues!.fileChanges = { files: [{ path: '/w/a.ts', lastAt: 200 }] }
      m.rerender()
    })
    expect(m.engine.store.getSnapshot().tabs['/w/a.ts']!.writeError).toBe('external-change')
  })

  it('does not raise a conflict when the changed tab is clean', () => {
    const m = mount({
      current: 's1',
      byId: { s1: { cwd: '/w', projectionValues: { fileChanges: { files: [{ path: '/w/a.ts', lastAt: 100 }] } } } },
    })
    act(() => {
      m.engine.actions.openTab('s1', '/w/a.ts')
      m.engine.actions.setTabContent('/w/a.ts', 'let n = 1\n')
      m.rerender()
    })
    act(() => {
      m.fixture.byId.s1!.projectionValues!.fileChanges = { files: [{ path: '/w/a.ts', lastAt: 200 }] }
      m.rerender()
    })
    // A clean tab is re-activated by the follow but carries no conflict.
    expect(m.engine.store.getSnapshot().tabs['/w/a.ts']!.writeError).toBeUndefined()
  })
})
