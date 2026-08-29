// The pinned 变更 tab: one row per changed file (newest-touched first) with
// edit/add/remove counts; expanding a row shows its last diff through the
// shared DiffBlock, and clicking a path opens the file in a document tab.
// Paths are stored model-facing (possibly relative); display relativizes
// against the session cwd and reads resolve back to absolute.

import { useState } from 'react'
import clsx from 'clsx'
import { DiffBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileChangesProjection } from '@deepseek-ai/dsh-file-changes/client'
import type { DocPanelKey } from './locales.ts'
import css from './DocPanelRoot.module.css'

/**
 * Resolve a model-facing path against the session cwd for a file read.
 * @param cwd - the session working directory (absent when unrecorded).
 * @param raw - the stored path (absolute or cwd-relative).
 * @returns an absolute path when resolvable, else the raw value.
 */
export function resolveAgainstCwd(cwd: string | undefined, raw: string): string {
  if (raw.startsWith('/')) return raw
  return cwd !== undefined ? `${cwd.replace(/\/$/, '')}/${raw}` : raw
}

/**
 * Display form of a stored path: absolute paths under the session cwd show
 * their relative tail; everything else shows verbatim.
 * @param cwd - the session working directory (absent when unrecorded).
 * @param raw - the stored path.
 * @returns the display string.
 */
export function relativeToCwd(cwd: string | undefined, raw: string): string {
  if (cwd === undefined || !raw.startsWith('/')) return raw
  const base = cwd.replace(/\/$/, '') + '/'
  return raw.startsWith(base) ? raw.slice(base.length) : raw
}

interface ChangesTabProps {
  /** The fileChanges projection value (undefined while absent). */
  changes: FileChangesProjection | undefined
  /** The session working directory for path display/resolution. */
  cwd: string | undefined
  /** Open one stored path in a document tab (receives the absolute form). */
  onOpenFile: (path: string) => void
  /** The panel locale seat. */
  t: (key: DocPanelKey) => string
}

/**
 * The session's file-change ledger (read-only; v1 offers no in-panel editing).
 * Rows expand to the last diff hunk set; paths open document tabs.
 */
export function ChangesTab({ changes, cwd, onOpenFile, t }: ChangesTabProps) {
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  const files = changes?.files ?? []
  if (files.length === 0) {
    return <div className={css.tabEmpty}>{t('changes.empty')}</div>
  }
  return (
    <div className={css.changesList} role="list">
      {files.map((file) => {
        const expanded = expandedPath === file.path
        return (
          <div key={file.path} className={css.changeRow} role="listitem">
            <div className={css.changeHead}>
              <button
                type="button"
                className={css.changeChevron}
                aria-expanded={expanded}
                onClick={() => { setExpandedPath(expanded ? null : file.path) }}
              >
                {expanded ? '▾' : '▸'}
              </button>
              <button
                type="button"
                className={css.changePath}
                title={file.path}
                onClick={() => { onOpenFile(resolveAgainstCwd(cwd, file.path)) }}
              >
                {relativeToCwd(cwd, file.path)}
              </button>
              <span className={css.changeStats}>
                <span className={css.changeAdded}>+{file.added}</span>
                <span className={css.changeRemoved}>−{file.removed}</span>
                <span className={css.changeEdits}>×{file.edits}</span>
              </span>
            </div>
            {expanded && file.lastDiff !== null && (
              <div className={clsx(css.changeDiff, 'doc-changes-diff')}>
                <DiffBlock diffs={file.lastDiff} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
