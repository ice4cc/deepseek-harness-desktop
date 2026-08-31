/**
 * The document panel's viewing-state store: per-session tab sets (recent
 * sessions kept), the global content cache keyed by absolute path, and the
 * auto-follow preference. Column geometry (open/closed, width) lives in the
 * layout store — this store holds only what the panel renders and which tab
 * is active where. File bytes never live here longer than a load: the
 * workspaces service owns the read.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

/** The pinned (non-file) tab id. */
export const CHANGES_TAB_ID = 'changes'

/** How one file tab renders its content. */
export type DocTabKind = 'markdown' | 'html' | 'code'

/** One open file tab (id === path; the content cache is global across sessions). */
export interface DocTab {
  /** Absolute host path (the tab's identity and dedupe key). */
  path: string
  /** Display name (path basename). */
  title: string
  /** Render mode, derived from the extension at open time. */
  kind: DocTabKind
  /** Tokenizer language for code tabs; absent for markdown/html. */
  language?: string
  /** Loaded file text; absent while loading or after a failed read. For code tabs this is the
   *  editor's seed, not live text (CodeMirror owns that). */
  content?: string
  /** Read failure (wire error code); present instead of content on failure. */
  error?: string
  /** True while the read is in flight. */
  loading: boolean
  /** Baseline freshness token from the last read/save; present once a code tab has loaded. */
  version?: string
  /** True while the editor's text differs from the on-disk baseline (unsaved changes). */
  dirty: boolean
  /** True while a save is in flight. */
  saving: boolean
  /** Last save/freshness failure: a wire code (e.g. `file/unwritable`) or a conflict marker (`file/stale-version`, `external-change`). */
  writeError?: string
}

/** One session's panel state (tab order + active tab). */
interface SessionPanelState {
  /** Open file paths, oldest-opened first. */
  tabPaths: string[]
  /** Active tab id: a file path, or one of the pinned ids. */
  activeId: string | null
}

/** The store state (see module doc). */
export interface DocPanelState {
  /** Auto-follow: new file changes open their tab and expand the panel column. */
  autoFollow: boolean
  /** Per-session tab sets, newest-touched first; bounded to {@link MAX_SESSIONS}. */
  sessions: Record<string, SessionPanelState>
  /** Global content cache keyed by absolute path. */
  tabs: Record<string, DocTab>
}

/** Annotation twin of the actions literal (the export needs a declared return type). */
export type DocPanelActions = {
  openTab: (draft: DocPanelState, sessionId: string, path: string) => void
  closeTab: (draft: DocPanelState, sessionId: string, path: string) => void
  setActive: (draft: DocPanelState, sessionId: string, id: string) => void
  setAutoFollow: (draft: DocPanelState, on: boolean) => void
  markLoading: (draft: DocPanelState, path: string, loading: boolean) => void
  setTabContent: (draft: DocPanelState, path: string, content: string) => void
  setTabError: (draft: DocPanelState, path: string, error: string) => void
  /** Record the baseline freshness token from a read or save. */
  setBaseline: (draft: DocPanelState, path: string, version: string) => void
  /** Mark unsaved changes (true on an editor edit; false after a save/reload). */
  setDirty: (draft: DocPanelState, path: string, dirty: boolean) => void
  /** Toggle the in-flight save flag. */
  setSaving: (draft: DocPanelState, path: string, saving: boolean) => void
  /** A save landed: refresh the baseline + seed, clear dirty/saving and any failure. */
  saveSucceeded: (draft: DocPanelState, path: string, version: string, content: string) => void
  /** A save was rejected: record the wire/conflict code and stop the saving flag. */
  saveFailed: (draft: DocPanelState, path: string, code: string) => void
  /** A file changed on disk while its tab is dirty: raise the conflict banner. */
  markExternalConflict: (draft: DocPanelState, path: string) => void
  /** Dismiss a save/freshness failure or conflict without changing content or the baseline. */
  clearWriteError: (draft: DocPanelState, path: string) => void
}

/** Per-session tab-set bound (older sessions forget their tabs; the content cache survives). */
export const MAX_SESSIONS = 10

/** Extension → render mode for the non-code kinds. */
const EXT_KINDS: Record<string, DocTabKind> = {
  md: 'markdown', markdown: 'markdown', html: 'html', htm: 'html',
}

/** Extension → tokenizer language for code tabs (absent extension stays plain). */
const EXT_LANGUAGES: Record<string, string> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  py: 'python', json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash', css: 'css',
  xml: 'xml', yml: 'yaml', yaml: 'yaml', sql: 'sql',
}

/** The path's extension (lowercased, no dot); empty when none. */
function extensionOf(path: string): string {
  /* v8 ignore next -- split always yields at least one element */
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/**
 * Derive a tab's display name and render mode from its path.
 * @param path - absolute host path.
 * @returns the title plus kind (and language for code tabs).
 */
export function detectTabShape(path: string): { title: string; kind: DocTabKind; language?: string } {
  /* v8 ignore next -- split always yields at least one element, so pop() cannot be undefined */
  const title = (path.split('/').pop() ?? '') || path
  const ext = extensionOf(path)
  const kind = EXT_KINDS[ext] ?? 'code'
  const language = kind === 'code' ? EXT_LANGUAGES[ext] : undefined
  return { title, kind, ...(language !== undefined ? { language } : {}) }
}

/**
 * Move a session to the newest position of the recency list, evicting the
 * oldest past the bound (its tab set is dropped; the content cache survives).
 */
function touchSession(draft: DocPanelState, sessionId: string): SessionPanelState {
  const rest = Object.fromEntries(Object.entries(draft.sessions).filter(([id]) => id !== sessionId))
  const panel = draft.sessions[sessionId] ?? { tabPaths: [], activeId: null }
  const entries = [[sessionId, panel], ...Object.entries(rest)] as [string, SessionPanelState][]
  while (entries.length > MAX_SESSIONS) entries.pop()
  draft.sessions = Object.fromEntries(entries)
  return panel
}

/**
 * Create the document panel store handle. Tab identity is the absolute path:
 * openTab dedupes, closeTab drops the tab from one session's set (the content
 * cache keeps the bytes for other sessions), and setActive accepts file paths
 * plus the two pinned ids.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createDocPanelStore(): EngineStoreHandle<DocPanelState, DocPanelActions> {
  return defineStore({
    init: (): DocPanelState => ({ autoFollow: true, sessions: {}, tabs: {} }),
    actions: {
      openTab: (d, sessionId, path) => {
        const panel = touchSession(d, sessionId)
        if (!panel.tabPaths.includes(path)) {
          panel.tabPaths.push(path)
          const shape = detectTabShape(path)
          d.tabs[path] = { path, ...shape, loading: true, dirty: false, saving: false }
        }
        panel.activeId = path
      },
      closeTab: (d, sessionId, path) => {
        const panel = d.sessions[sessionId]
        if (panel === undefined) return
        panel.tabPaths = panel.tabPaths.filter(p => p !== path)
        if (panel.activeId === path) panel.activeId = panel.tabPaths[panel.tabPaths.length - 1] ?? CHANGES_TAB_ID
      },
      setActive: (d, sessionId, id) => {
        const panel = touchSession(d, sessionId)
        panel.activeId = id
      },
      setAutoFollow: (d, on) => { d.autoFollow = on },
      markLoading: (d, path, loading) => {
        const tab = d.tabs[path]
        if (tab !== undefined) tab.loading = loading
      },
      setTabContent: (d, path, content) => {
        const tab = d.tabs[path]
        if (tab === undefined) return
        tab.content = content
        tab.loading = false
        delete tab.error
      },
      setTabError: (d, path, error) => {
        const tab = d.tabs[path]
        if (tab === undefined) return
        tab.error = error
        tab.loading = false
      },
      setBaseline: (d, path, version) => {
        const tab = d.tabs[path]
        if (tab !== undefined) tab.version = version
      },
      setDirty: (d, path, dirty) => {
        const tab = d.tabs[path]
        if (tab !== undefined) tab.dirty = dirty
      },
      setSaving: (d, path, saving) => {
        const tab = d.tabs[path]
        if (tab !== undefined) tab.saving = saving
      },
      saveSucceeded: (d, path, version, content) => {
        const tab = d.tabs[path]
        if (tab === undefined) return
        tab.version = version
        tab.content = content
        tab.dirty = false
        tab.saving = false
        delete tab.writeError
      },
      saveFailed: (d, path, code) => {
        const tab = d.tabs[path]
        if (tab === undefined) return
        tab.saving = false
        tab.writeError = code
      },
      markExternalConflict: (d, path) => {
        const tab = d.tabs[path]
        if (tab !== undefined && tab.dirty) tab.writeError = 'external-change'
      },
      clearWriteError: (d, path) => {
        const tab = d.tabs[path]
        if (tab !== undefined) delete tab.writeError
      },
    },
  })
}
