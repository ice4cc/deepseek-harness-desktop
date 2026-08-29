// The document tab's content views: Markdown (rendered/source toggle), HTML
// (sandboxed iframe, no script), and code (editable CodeMirror via CodeTab).
// Loading and error states are shared chrome above the body.

import { useState } from 'react'
import clsx from 'clsx'
import type { DocTab } from './store.ts'
import { CodeTab, type CodeTabControls } from './CodeTab.tsx'
import { renderMarkdown, type MarkdownClasses } from './render/md.tsx'
import type { DocPanelKey } from './locales.ts'
import css from './DocPanelRoot.module.css'

/** The Markdown renderer's class table. */
const MD_CLASSES: MarkdownClasses = { code: css.mdCode }

interface DocViewProps {
  /** The tab being rendered (its kind selects the view). */
  tab: DocTab
  /** The panel locale seat. */
  t: (key: DocPanelKey) => string
  /** The save/freshness callbacks for code tabs (markdown/html ignore them). */
  controls: CodeTabControls
}

/**
 * One open file's body: loading/error chrome plus the kind-selected view.
 * Markdown tabs carry a rendered/source toggle; HTML renders in a scriptless
 * sandboxed iframe; code mounts the editable CodeTab (CodeMirror + save seam).
 */
export function DocView({ tab, t, controls }: DocViewProps) {
  const [showSource, setShowSource] = useState(false)
  if (tab.loading && tab.content === undefined) {
    return <div className={css.viewState}>{t('file.loading')}</div>
  }
  if (tab.error !== undefined) {
    /* v8 ignore next -- content and error are mutually exclusive; setTabContent clears the error once content lands */
    if (tab.content === undefined) return <div className={clsx(css.viewState, css.viewError)}>{t('file.error')}（{tab.error}）</div>
  }
  const content = tab.content ?? ''
  const toggle = tab.kind === 'markdown' ? (
    <div className={css.viewToggle}>
      <button type="button" className={clsx(css.toggleBtn, !showSource && css.toggleActive)} onClick={() => { setShowSource(false) }}>{t('view.markdown')}</button>
      <button type="button" className={clsx(css.toggleBtn, showSource && css.toggleActive)} onClick={() => { setShowSource(true) }}>{t('view.source')}</button>
    </div>
  ) : null
  return (
    <div className={css.viewBody}>
      {toggle}
      {tab.kind === 'markdown'
        ? showSource
          ? <pre className={css.codePre}>{content}</pre>
          : <div className={css.markdown}>{renderMarkdown(content, MD_CLASSES)}</div>
        : tab.kind === 'html'
          ? <iframe className={css.htmlFrame} sandbox="" srcDoc={content} title={tab.title} />
          : <CodeTab tab={tab} t={t} controls={controls} />}
    </div>
  )
}
