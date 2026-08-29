// @vitest-environment jsdom
/**
 * createDocPanelStore unit account: init shape, tab open/close/active
 * semantics (path identity, dedupe), the read-result landers, and the
 * per-session recency bound. Uses the test-sanctioned path: factory
 * self-call + .create() gives the real engine instance.
 */
import { describe, expect, it } from 'vitest'
import {
  CHANGES_TAB_ID, MAX_SESSIONS, createDocPanelStore, detectTabShape,
} from '@deepseek-ai/dsh-client-ui-doc-panel/src/client/store.ts'

describe('detectTabShape', () => {
  it('maps document extensions to their render kinds', () => {
    expect(detectTabShape('/a/b/notes.md')).toEqual({ title: 'notes.md', kind: 'markdown' })
    expect(detectTabShape('/a/b/page.MARKDOWN')).toEqual({ title: 'page.MARKDOWN', kind: 'markdown' })
    expect(detectTabShape('/a/b/index.html')).toEqual({ title: 'index.html', kind: 'html' })
    expect(detectTabShape('/a/b/old.htm')).toEqual({ title: 'old.htm', kind: 'html' })
  })

  it('maps code extensions to their tokenizer languages', () => {
    expect(detectTabShape('/x/main.tsx')).toEqual({ title: 'main.tsx', kind: 'code', language: 'tsx' })
    expect(detectTabShape('/x/app.mjs')).toEqual({ title: 'app.mjs', kind: 'code', language: 'js' })
    expect(detectTabShape('/x/run.sh')).toEqual({ title: 'run.sh', kind: 'code', language: 'bash' })
    expect(detectTabShape('/x/cfg.yaml')).toEqual({ title: 'cfg.yaml', kind: 'code', language: 'yaml' })
  })

  it('leaves unknown and extensionless files as plain code tabs', () => {
    expect(detectTabShape('/x/Makefile')).toEqual({ title: 'Makefile', kind: 'code' })
    expect(detectTabShape('/x/data.xyz123')).toEqual({ title: 'data.xyz123', kind: 'code' })
  })

  it('handles dotfiles and bare names without a directory', () => {
    // A leading dot is not an extension separator (dot > 0 guard).
    expect(detectTabShape('/x/.envrc')).toEqual({ title: '.envrc', kind: 'code' })
    expect(detectTabShape('README.md')).toEqual({ title: 'README.md', kind: 'markdown' })
    // A trailing slash leaves no basename; the full path is the title.
    expect(detectTabShape('/a/b/')).toEqual({ title: '/a/b/', kind: 'code' })
  })
})

describe('createDocPanelStore', () => {
  it('initializes following on, with no sessions or tabs', () => {
    const { store } = createDocPanelStore().create()
    expect(store.getSnapshot()).toEqual({ autoFollow: true, sessions: {}, tabs: {} })
  })

  it('openTab creates a loading tab, activates it, and dedupes by path', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.openTab('s1', '/a/one.md')
    let snap = store.getSnapshot()
    expect(snap.sessions.s1).toEqual({ tabPaths: ['/a/one.md'], activeId: '/a/one.md' })
    expect(snap.tabs['/a/one.md']).toMatchObject({ path: '/a/one.md', title: 'one.md', kind: 'markdown', loading: true })

    actions.openTab('s1', '/a/two.ts')
    snap = store.getSnapshot()
    expect(snap.sessions.s1).toEqual({ tabPaths: ['/a/one.md', '/a/two.ts'], activeId: '/a/two.ts' })

    // Re-opening an existing path activates without a second entry or a fresh load.
    actions.openTab('s1', '/a/one.md')
    snap = store.getSnapshot()
    expect(snap.sessions.s1!.tabPaths).toEqual(['/a/one.md', '/a/two.ts'])
    expect(snap.sessions.s1!.activeId).toBe('/a/one.md')
    expect(Object.keys(snap.tabs)).toHaveLength(2)
  })

  it('keeps tab sets per session (same path, two sessions)', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.openTab('s1', '/a/one.md')
    actions.openTab('s2', '/a/one.md')
    const snap = store.getSnapshot()
    expect(snap.sessions.s1).toEqual({ tabPaths: ['/a/one.md'], activeId: '/a/one.md' })
    expect(snap.sessions.s2).toEqual({ tabPaths: ['/a/one.md'], activeId: '/a/one.md' })
  })

  it('closeTab drops the tab and falls back to the newest remaining or changes', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.openTab('s1', '/a/one.md')
    actions.openTab('s1', '/a/two.ts')
    actions.closeTab('s1', '/a/one.md')
    let snap = store.getSnapshot()
    expect(snap.sessions.s1).toEqual({ tabPaths: ['/a/two.ts'], activeId: '/a/two.ts' })

    actions.closeTab('s1', '/a/two.ts')
    snap = store.getSnapshot()
    expect(snap.sessions.s1).toEqual({ tabPaths: [], activeId: CHANGES_TAB_ID })
  })

  it('closeTab on an unknown session is a no-op', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.closeTab('ghost', '/a/one.md')
    expect(store.getSnapshot().sessions).toEqual({})
  })

  it('setActive accepts file paths and pinned ids and touches recency', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.openTab('s1', '/a/one.md')
    actions.openTab('s2', '/b/two.ts')
    actions.setActive('s1', CHANGES_TAB_ID)
    let snap = store.getSnapshot()
    expect(snap.sessions.s1!.activeId).toBe(CHANGES_TAB_ID)
    // s1 moved to the newest position.
    expect(Object.keys(snap.sessions)).toEqual(['s1', 's2'])

    actions.setActive('s2', '/b/two.ts')
    snap = store.getSnapshot()
    expect(Object.keys(snap.sessions)).toEqual(['s2', 's1'])
  })

  it('evicts the oldest session past the recency bound (content cache survives)', () => {
    const { store, actions } = createDocPanelStore().create()
    for (let n = 0; n < MAX_SESSIONS + 3; n += 1) {
      actions.openTab(`s${n}`, `/f/${n}.md`)
    }
    let snap = store.getSnapshot()
    expect(Object.keys(snap.sessions)).toHaveLength(MAX_SESSIONS)
    // The two oldest sessions are gone…
    expect(snap.sessions.s0).toBeUndefined()
    expect(snap.sessions.s1).toBeUndefined()
    // …but their content cache entries remain for other sessions.
    expect(snap.tabs['/f/0.md']).toBeDefined()
    expect(snap.tabs['/f/1.md']).toBeDefined()

    // Re-touching an evicted session re-creates its (empty) tab set.
    actions.setActive('s0', CHANGES_TAB_ID)
    snap = store.getSnapshot()
    expect(snap.sessions.s0).toEqual({ tabPaths: [], activeId: CHANGES_TAB_ID })
  })

  it('setTabContent lands bytes and clears loading and a prior error', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.openTab('s1', '/a/one.md')
    actions.setTabError('/a/one.md', 'file-unreadable')
    actions.setTabContent('/a/one.md', '# hi\n')
    const tab = store.getSnapshot().tabs['/a/one.md']!
    expect(tab).toMatchObject({ content: '# hi\n', loading: false })
    expect(tab.error).toBeUndefined()
  })

  it('setTabError lands the code and clears loading', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.openTab('s1', '/a/one.md')
    actions.setTabError('/a/one.md', 'file-too-large')
    const tab = store.getSnapshot().tabs['/a/one.md']!
    expect(tab).toMatchObject({ error: 'file-too-large', loading: false })
    expect(tab.content).toBeUndefined()
  })

  it('read landers and markLoading no-op for paths without an open tab', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.setTabContent('/ghost.md', 'x')
    actions.setTabError('/ghost.md', 'file-unreadable')
    actions.markLoading('/ghost.md', true)
    expect(store.getSnapshot().tabs).toEqual({})

    actions.openTab('s1', '/a/one.md')
    actions.markLoading('/a/one.md', false)
    expect(store.getSnapshot().tabs['/a/one.md']!.loading).toBe(false)
  })

  it('setAutoFollow flips the flag', () => {
    const { store, actions } = createDocPanelStore().create()
    actions.setAutoFollow(false)
    expect(store.getSnapshot().autoFollow).toBe(false)
  })

  it('each create() is an independent instance (factory is not a singleton)', () => {
    const a = createDocPanelStore().create()
    const b = createDocPanelStore().create()
    a.actions.setAutoFollow(false)
    expect(b.store.getSnapshot().autoFollow).toBe(true)
  })
})

describe('createDocPanelStore editing state machine', () => {
  type Created = ReturnType<ReturnType<typeof createDocPanelStore>['create']>
  function opened(path: string): Created {
    const created = createDocPanelStore().create()
    created.actions.openTab('s1', path)
    return created
  }

  it('openTab initializes a code tab clean (not dirty, not saving)', () => {
    const { store } = opened('/a/x.ts')
    expect(store.getSnapshot().tabs['/a/x.ts']).toMatchObject({ dirty: false, saving: false })
    expect(store.getSnapshot().tabs['/a/x.ts']!.version).toBeUndefined()
  })

  it('setBaseline records the freshness token from a read or save', () => {
    const { store, actions } = opened('/a/x.ts')
    actions.setBaseline('/a/x.ts', '1:2:3:4:5')
    expect(store.getSnapshot().tabs['/a/x.ts']!.version).toBe('1:2:3:4:5')
  })

  it('setDirty and setSaving toggle their flags independently', () => {
    const { store, actions } = opened('/a/x.ts')
    actions.setDirty('/a/x.ts', true)
    expect(store.getSnapshot().tabs['/a/x.ts']!.dirty).toBe(true)
    actions.setSaving('/a/x.ts', true)
    let tab = store.getSnapshot().tabs['/a/x.ts']!
    expect(tab.saving).toBe(true)
    expect(tab.dirty).toBe(true)
    actions.setDirty('/a/x.ts', false)
    tab = store.getSnapshot().tabs['/a/x.ts']!
    expect(tab.dirty).toBe(false)
    expect(tab.saving).toBe(true)
  })

  it('saveSucceeded refreshes the baseline and seed, clearing dirty/saving and a prior failure', () => {
    const { store, actions } = opened('/a/x.ts')
    actions.setBaseline('/a/x.ts', 'v1')
    actions.setDirty('/a/x.ts', true)
    actions.setSaving('/a/x.ts', true)
    actions.saveFailed('/a/x.ts', 'file-stale-version')
    actions.saveSucceeded('/a/x.ts', 'v2', 'let n = 2\n')
    const tab = store.getSnapshot().tabs['/a/x.ts']!
    expect(tab.version).toBe('v2')
    expect(tab.content).toBe('let n = 2\n')
    expect(tab.dirty).toBe(false)
    expect(tab.saving).toBe(false)
    expect(tab.writeError).toBeUndefined()
  })

  it('saveFailed records the code and stops the saving flag', () => {
    const { store, actions } = opened('/a/x.ts')
    actions.setSaving('/a/x.ts', true)
    actions.saveFailed('/a/x.ts', 'file-unwritable')
    const tab = store.getSnapshot().tabs['/a/x.ts']!
    expect(tab.writeError).toBe('file-unwritable')
    expect(tab.saving).toBe(false)
  })

  it('markExternalConflict raises the banner only for a dirty tab', () => {
    const { store, actions } = opened('/a/x.ts')
    // Clean tab: no conflict.
    actions.markExternalConflict('/a/x.ts')
    expect(store.getSnapshot().tabs['/a/x.ts']!.writeError).toBeUndefined()
    // Dirty tab: the on-disk-move marker lands.
    actions.setDirty('/a/x.ts', true)
    actions.markExternalConflict('/a/x.ts')
    expect(store.getSnapshot().tabs['/a/x.ts']!.writeError).toBe('external-change')
  })

  it('clearWriteError dismisses a failure without touching content or the baseline', () => {
    const { store, actions } = opened('/a/x.ts')
    actions.setBaseline('/a/x.ts', 'v1')
    actions.setDirty('/a/x.ts', true)
    actions.saveFailed('/a/x.ts', 'file-stale-version')
    actions.clearWriteError('/a/x.ts')
    const tab = store.getSnapshot().tabs['/a/x.ts']!
    expect(tab.writeError).toBeUndefined()
    // The local edits and baseline survive a cancel.
    expect(tab.dirty).toBe(true)
    expect(tab.version).toBe('v1')
  })

  it('editing actions no-op for paths without an open tab', () => {
    const { store, actions } = opened('/a/x.ts')
    actions.setBaseline('/ghost.ts', 'v9')
    actions.setDirty('/ghost.ts', true)
    actions.saveSucceeded('/ghost.ts', 'v9', 'x')
    actions.saveFailed('/ghost.ts', 'file-unwritable')
    actions.markExternalConflict('/ghost.ts')
    actions.clearWriteError('/ghost.ts')
    expect(Object.keys(store.getSnapshot().tabs)).toEqual(['/a/x.ts'])
  })
})
