// The editable code tab: a CodeMirror view plus the save/freshness machinery.
// Cmd/Ctrl+S persists with the version guard; a conflict banner (reload /
// overwrite / cancel) surfaces a stale save or an on-disk move while the tab is
// dirty; non-conflict save failures show a plain error line. The live text stays
// in CodeMirror — only flags cross into the store through the callbacks.

import { useCallback, useEffect, useRef } from 'react'
import clsx from 'clsx'
import type { DocTab } from './store.ts'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor.tsx'
import type { DocReadResult, DocSaveResult } from './contract/slots.ts'
import css from './DocPanelRoot.module.css'

/** The store-action callbacks the tab drives (bound in the panel root). */
export interface CodeTabControls {
  readFile: (path: string) => Promise<DocReadResult>
  saveFile: (path: string, content: string, expectedVersion?: string) => Promise<DocSaveResult>
  setDirty: (path: string, dirty: boolean) => void
  setSaving: (path: string, saving: boolean) => void
  saveSucceeded: (path: string, version: string, content: string) => void
  saveFailed: (path: string, code: string) => void
  clearWriteError: (path: string) => void
}

interface CodeTabProps {
  /** The tab being edited (its flags drive the banner; its content seeds the view). */
  tab: DocTab
  /** The panel locale seat. */
  t: (key: 'conflict.changed' | 'conflict.reload' | 'conflict.overwrite' | 'conflict.cancel' | 'save.error') => string
  /** The save/freshness callbacks (see {@link CodeTabControls}). */
  controls: CodeTabControls
}

/** A conflict marker (as opposed to a plain save failure). */
function isConflict(code: string | undefined): boolean {
  return code === 'file-stale-version' || code === 'external-change'
}

/** One editable code file (see module doc). */
export function CodeTab({ tab, t, controls }: CodeTabProps) {
  const editorRef = useRef<CodeEditorHandle>(null)
  const conflict = isConflict(tab.writeError)
  const hardError = !conflict && tab.writeError !== undefined

  const doSave = useCallback(async () => {
    const view = editorRef.current
    if (view === null || tab.saving) return
    const text = view.getText()
    controls.setSaving(tab.path, true)
    const result = await controls.saveFile(tab.path, text, tab.version)
    if (result.ok) controls.saveSucceeded(tab.path, result.version, text)
    else controls.saveFailed(tab.path, result.code)
  }, [tab.path, tab.version, tab.saving, controls])

  // Cmd/Ctrl+S persists the open file while this tab is mounted. The browser's
  // default save-page is suppressed so the shortcut reaches the editor.
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void doSave()
      }
    }
    document.addEventListener('keydown', handler)
    return () => { document.removeEventListener('keydown', handler) }
  }, [doSave])

  const doReload = useCallback(async () => {
    const result = await controls.readFile(tab.path)
    if (!result.ok) { controls.saveFailed(tab.path, result.code); return }
    editorRef.current?.reload(result.content)
    controls.saveSucceeded(tab.path, result.version, result.content)
  }, [tab.path, controls])

  const doOverwrite = useCallback(async () => {
    const view = editorRef.current
    if (view === null || tab.saving) return
    const text = view.getText()
    controls.setSaving(tab.path, true)
    // Unconditional: the user just chose to overwrite a changed file explicitly.
    const result = await controls.saveFile(tab.path, text)
    if (result.ok) controls.saveSucceeded(tab.path, result.version, text)
    else controls.saveFailed(tab.path, result.code)
  }, [tab.path, tab.saving, controls])

  return (
    <div className={css.codeTab}>
      {conflict && (
        <div className={css.conflictBanner} role="alert">
          <span className={css.conflictText}>{t('conflict.changed')}</span>
          <button type="button" className={css.conflictBtn} onClick={() => { void doReload() }}>{t('conflict.reload')}</button>
          <button type="button" className={clsx(css.conflictBtn, css.conflictPrimary)} disabled={tab.saving} onClick={() => { void doOverwrite() }}>{t('conflict.overwrite')}</button>
          <button type="button" className={css.conflictBtn} onClick={() => { controls.clearWriteError(tab.path) }}>{t('conflict.cancel')}</button>
        </div>
      )}
      {hardError && (
        <div className={css.saveError} role="alert">{t('save.error')}（{tab.writeError}）</div>
      )}
      <CodeEditor
        ref={editorRef}
        content={tab.content ?? ''}
        language={tab.language ?? ''}
        editable
        onDirtyChange={() => { if (!tab.dirty) controls.setDirty(tab.path, true) }}
      />
    </div>
  )
}
