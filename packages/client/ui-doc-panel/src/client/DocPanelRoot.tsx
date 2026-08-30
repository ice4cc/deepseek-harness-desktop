// The document panel root: the occupant of the layout-owned docPanel grid
// column (between the conversation and the details columns). One corner
// toggle portaled into the frame's overlay layer is always visible — its
// label and action flip with the column state, so close is a pure track
// animation under a stationary button. The column body stays mounted in both
// states: collapsed, the track animates to zero width and clips it; expanded,
// the body fills the column with the tab strip and the active tab's view.
// Auto-follow watches the fileChanges projection for newer lastAt values per
// path (baseline reset on session switch) and opens the changed file, opening
// the panel column while following is on.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Button, IconPanelRightOutline16, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocPanelRootComponentProps } from './contract/slots.ts'
import { CHANGES_TAB_ID } from './store.ts'
import { ChangesTab, resolveAgainstCwd } from './ChangesTab.tsx'
import { TabBar } from './TabBar.tsx'
import { DocView } from './views.tsx'
import type { CodeTabControls } from './CodeTab.tsx'
import css from './DocPanelRoot.module.css'

// React 18's JSX types predate inert, so the attribute rides a spread object.
// Chromium keeps an inert subtree in the accessibility tree (exposed as
// disabled), so the collapsed body also carries aria-hidden to leave assistive
// tech entirely; neither attribute hides its paint.
const INERT = { inert: '', 'aria-hidden': true }

/**
 * The panel entry (see module doc). All session data arrives through the
 * standard useSessions delivery; file reads and column transitions ride the
 * injected callbacks.
 */
export function DocPanelRoot({
  collapsed, useStore, useSessions, actions, readFile, saveFile, openPanel, closePanel, t,
}: DocPanelRootComponentProps) {
  const state = useStore(s => s)
  const currentSessionId = useSessions(s => s.current)
  const fileChanges = useSessions(s => s.current !== undefined ? s.byId[s.current]?.projectionValues?.fileChanges : undefined)
  const cwd = useSessions(s => s.current !== undefined ? s.byId[s.current]?.cwd : undefined)
  const panel = currentSessionId !== undefined ? state.sessions[currentSessionId] : undefined

  // Auto-follow: a per-path lastAt baseline; switching sessions re-baselines
  // (pre-existing changes do not flood the tab strip), and only strictly
  // newer touches follow while autoFollow is on.
  const seenRef = useRef<Record<string, number>>({})
  const baselinedSessionRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (currentSessionId === undefined) return
    const files = fileChanges?.files ?? []
    const seen = seenRef.current
    if (baselinedSessionRef.current !== currentSessionId) {
      baselinedSessionRef.current = currentSessionId
      for (const file of files) seen[file.path] = file.lastAt
      return
    }
    if (!state.autoFollow) return
    let followed = false
    for (const file of files) {
      const prev = seen[file.path]
      if (prev !== undefined && file.lastAt <= prev) continue
      seen[file.path] = file.lastAt
      const resolved = resolveAgainstCwd(cwd, file.path)
      // A dirty open tab surfaces the conflict banner instead of being clobbered;
      // the action is a no-op unless that tab is actually dirty.
      actions.markExternalConflict(resolved)
      actions.openTab(currentSessionId, resolved)
      followed = true
    }
    if (followed) openPanel()
  }, [fileChanges, currentSessionId, state.autoFollow, cwd, actions, openPanel])

  // Load-on-open: every open tab still awaiting its first read gets one read
  // in flight; the in-flight set dedupes re-runs until content or an error lands.
  const inFlightRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (panel === undefined) return
    for (const path of panel.tabPaths) {
      const tab = state.tabs[path]
      /* v8 ignore next -- openTab mints its cache entry before the path enters any tab set, and nothing ever deletes cache entries */
      if (tab === undefined) continue
      if (tab.content !== undefined || tab.error !== undefined) {
        inFlightRef.current.delete(path)
        continue
      }
      if (!tab.loading || inFlightRef.current.has(path)) continue
      inFlightRef.current.add(path)
      readFile(path)
    }
  }, [state, panel, readFile])

  // The dirty-close guard: closing a tab with unsaved changes asks first; the
  // pending path (null = no prompt) drives the discard-or-cancel modal.
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null)

  // The corner toggle portals into the frame's overlay layer (queried per
  // render so an HMR-swapped layer node is picked up on the next paint).
  const overlayLayer = document.querySelector<HTMLElement>('[data-shell-overlay]')

  const activeTab = panel?.activeId !== undefined && panel.activeId !== null && panel.activeId !== CHANGES_TAB_ID
    ? state.tabs[panel.activeId]
    : undefined
  const changesCount = fileChanges?.files.length ?? 0

  // The Changes tab button renders even without a current session, so its
  // guard is live; file tabs and change rows exist only with a current
  // session's panel/projection, so their guards are type bridges.
  const activate = (id: string) => { if (currentSessionId !== undefined) actions.setActive(currentSessionId, id) }
  const closeFile = (path: string) => {
    /* v8 ignore next -- file tabs exist only while a current session has a panel */
    if (currentSessionId === undefined) return
    // A dirty tab asks before discarding; a clean one closes directly.
    const tab = state.tabs[path]
    if (tab !== undefined && tab.dirty) { setPendingClosePath(path); return }
    actions.closeTab(currentSessionId, path)
  }
  const openFile = (path: string) => {
    /* v8 ignore next -- change rows render only with a current session's projection */
    if (currentSessionId === undefined) return
    actions.openTab(currentSessionId, path)
  }

  // The save/freshness callbacks the code tabs drive: the injected wire calls
  // plus the store-action bindings.
  const controls: CodeTabControls = {
    readFile,
    saveFile,
    setDirty: (path, dirty) => actions.setDirty(path, dirty),
    setSaving: (path, saving) => actions.setSaving(path, saving),
    saveSucceeded: (path, version, content) => actions.saveSucceeded(path, version, content),
    saveFailed: (path, code) => actions.saveFailed(path, code),
    clearWriteError: path => actions.clearWriteError(path),
  }

  return (
    <>
      {overlayLayer !== null && createPortal(
        // One persistent corner toggle in both states (the sidebar
        // floating-toggle lesson): the node never unmounts and never moves, so
        // close is a pure track animation under a stationary button; its label
        // and action flip with the column state. side="bottom" keeps the bubble
        // off the viewport's right edge, where a default right-side bubble
        // slides back over the anchor and swallows the click's mouseup (focus-
        // on-mousedown shows it immediately); Tooltip arms its delay timer only
        // on a real pointer move, so the synthetic mouseenter a close dispatches
        // under a stationary cursor never pops a bubble.
        <Tooltip label={collapsed ? t('panel.expand') : t('panel.collapse')} side="bottom" delayMs={500}>
          <button type="button" className={css.cornerToggle} aria-label={collapsed ? t('panel.expand') : t('panel.collapse')} onClick={() => { if (collapsed) openPanel(); else closePanel() }}>
            <IconPanelRightOutline16 size={16} />
          </button>
        </Tooltip>,
        overlayLayer,
      )}
      {/* The column body stays mounted through close (the details-column
          pattern; the docCol contract is never unmount on close): the track
          animates to zero and clips it as it goes, so close never flashes an
          empty strip. Collapsed, INERT drops the body from focus and
          interaction and aria-hidden takes it out of the accessibility tree
          (Chromium keeps inert subtrees in that tree, marked disabled). */}
      <section className={css.panel} aria-label={t('panel.title')} {...(collapsed ? INERT : undefined)}>
        <header className={css.header}>
          {/* Window title-bar band (draggable on the desktop shell); the corner
              toggle is portaled into the frame's overlay layer above it. */}
          <div className={css.titlebar} />
          <div className={css.regionRow}>
            <span className={css.regionTitle}>{t('panel.title')}</span>
            <button
              type="button"
              className={clsx(css.followToggle, state.autoFollow && css.followOn)}
              aria-pressed={state.autoFollow}
              title={state.autoFollow ? t('follow.off') : t('follow.on')}
              onClick={() => { actions.setAutoFollow(!state.autoFollow) }}
            >
              {t('follow.toggle')}
            </button>
          </div>
        </header>
        <div className={css.tabRow}>
          <TabBar
            tabPaths={panel?.tabPaths ?? []}
            tabs={state.tabs}
            activeId={panel?.activeId ?? null}
            changesCount={changesCount}
            onActivate={activate}
            onClose={closeFile}
            t={t}
          />
        </div>
        <div className={css.body}>
          {activeTab !== undefined
            ? <DocView tab={activeTab} t={t} controls={controls} />
            : <ChangesTab changes={fileChanges} cwd={cwd} onOpenFile={openFile} t={t} />}
        </div>
      </section>
      <Modal
        open={pendingClosePath !== null}
        onClose={() => setPendingClosePath(null)}
        closeLabel={t('conflict.cancel')}
        title={t('tab.discard.title')}
        footer={(
          <>
            <Button variant="outline" onClick={() => setPendingClosePath(null)}>{t('conflict.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
              /* v8 ignore next -- the modal only opens for a file tab with a current session */
                if (pendingClosePath !== null && currentSessionId !== undefined) actions.closeTab(currentSessionId, pendingClosePath)
                setPendingClosePath(null)
              }}
            >
              {t('tab.discard.confirm')}
            </Button>
          </>
        )}
      >
        <div className={css.modalBody}>{t('tab.discard.body')}</div>
      </Modal>
    </>
  )
}
