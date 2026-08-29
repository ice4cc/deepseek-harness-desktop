// The panel's tab strip: the pinned 变更 tab (with a change-count badge) plus
// one closable tab per open file. Active state is the store's activeId; the
// strip reports clicks upward and holds no business state of its own.

import clsx from 'clsx'
import { CHANGES_TAB_ID, type DocTab } from './store.ts'
import type { DocPanelKey } from './locales.ts'
import css from './DocPanelRoot.module.css'

interface TabBarProps {
  /** Open file paths for the current session (oldest first). */
  tabPaths: string[]
  /** The global content cache (tab display fields live here). */
  tabs: Record<string, DocTab>
  /** The active tab id (a path or the pinned changes id). */
  activeId: string | null
  /** File-change row count for the badge. */
  changesCount: number
  /** Activate one tab (path or pinned id). */
  onActivate: (id: string) => void
  /** Close one file tab. */
  onClose: (path: string) => void
  /** The panel locale seat. */
  t: (key: DocPanelKey) => string
}

/** The tab strip (see module doc). */
export function TabBar({ tabPaths, tabs, activeId, changesCount, onActivate, onClose, t }: TabBarProps) {
  return (
    <div className={css.tabList} role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={activeId === CHANGES_TAB_ID || activeId === null}
        className={clsx(css.tab, (activeId === CHANGES_TAB_ID || activeId === null) && css.tabActive)}
        onClick={() => { onActivate(CHANGES_TAB_ID) }}
      >
        {t('tab.changes')}
        {changesCount > 0 && <span className={css.tabBadge}>{changesCount}</span>}
      </button>
      {tabPaths.map((path) => {
        const tab = tabs[path]
        if (tab === undefined) return null
        return (
          <span key={path} className={clsx(css.tab, css.fileTab, activeId === path && css.tabActive)} role="tab" aria-selected={activeId === path}>
            <button type="button" className={css.tabLabel} title={tab.path} onClick={() => { onActivate(path) }}>
              {tab.title}
              {tab.dirty && <span className={css.tabDirty} aria-hidden="true">●</span>}
            </button>
            <button type="button" className={css.tabClose} aria-label={t('file.close')} onClick={() => { onClose(path) }}>×</button>
          </span>
        )
      })}
    </div>
  )
}
