// The document panel's code surface: a CodeMirror 6 view that replaces the
// hand-rolled tokenizer for code-kind tabs. Virtualized (visible lines only, so
// multi-MB files scroll without stalling the frame), with line numbers, an
// active-line highlight, a fold gutter, bracket matching, and in-file search.
// The palette references the shared --shiki-* / --dsw-* custom properties so
// the panel agrees with the chat code blocks — CodeMirror emits its styles
// through a style tag, so the var() references resolve against the document (no
// second color table). The view owns its EditorState: no document text passes
// through React state per keystroke. A parent reads the live text and reloads
// the doc through the imperative handle.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import {
  EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers,
} from '@codemirror/view'
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, syntaxHighlighting, type LanguageSupport } from '@codemirror/language'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { json } from '@codemirror/lang-json'
import { css as cssLang } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { sql } from '@codemirror/lang-sql'
import css from './DocPanelRoot.module.css'

/** The one highlight table: Lezer tags mapped onto the shared --shiki-* palette. */
const HIGHLIGHT = HighlightStyle.define([
  { tag: t.comment, color: 'var(--shiki-token-comment)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--shiki-token-string)' },
  { tag: t.keyword, color: 'var(--shiki-token-keyword)' },
  { tag: [t.bool, t.null, t.number], color: 'var(--shiki-token-constant)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--shiki-token-function)' },
  { tag: t.definition(t.variableName), color: 'var(--shiki-foreground)' },
  { tag: [t.operator, t.punctuation], color: 'var(--shiki-token-punctuation)' },
])

/** Editor chrome (sizing + the active-line/gutter wash) on the shared tokens. */
const THEME = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent', color: 'var(--shiki-foreground)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '20px' },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--shiki-token-punctuation)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--shiki-foreground)' },
})

/**
 * Map the store's tokenizer language key onto a Lezer grammar. Languages with no
 * official Lezer grammar (bash/sh/yaml) and unknown extensions stay plain text.
 * @param language - the tab's language key (absent for extension-less files).
 */
function languageSupport(language: string): LanguageSupport | undefined {
  switch (language) {
    case 'js': return javascript()
    case 'jsx': return javascript({ jsx: true })
    case 'ts': return javascript({ typescript: true })
    case 'tsx': return javascript({ typescript: true, jsx: true })
    case 'python': return python()
    case 'json': return json()
    case 'css': return cssLang()
    case 'html':
    case 'xml': return html()
    case 'sql': return sql()
    default: return undefined
  }
}

/** The parent-facing editor API (read the live text, replace the doc on reload). */
export interface CodeEditorHandle {
  /** The editor's current full text. */
  getText(): string
  /** Replace the whole document (a reload — not reported as a user edit). */
  reload(text: string): void
}

interface CodeEditorProps {
  /** The file text to seed the view with (the view owns it from here on). */
  content: string
  /** The tab's language key (drives grammar selection; empty stays plain). */
  language: string
  /** Whether the view accepts edits (code tabs in the editing surface). */
  editable?: boolean
  /** Called once per document change (the parent decides what "dirty" means). */
  onDirtyChange?: () => void
}

/** Build the editor's extension set for one seed. */
function buildExtensions(
  content: string,
  language: string,
  editable: boolean,
  onDirty: () => void,
): { doc: string; extensions: Extension[] } {
  const support = languageSupport(language)
  const base: Extension[] = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    foldGutter(),
    bracketMatching(),
    syntaxHighlighting(HIGHLIGHT),
    EditorView.updateListener.of((update) => { if (update.docChanged) onDirty() }),
    THEME,
  ]
  const keys = editable
    ? keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap])
    : keymap.of([...searchKeymap, ...defaultKeymap])
  const editing: Extension[] = editable ? [history(), indentOnInput()] : [EditorView.editable.of(false)]
  return { doc: content, extensions: [...base, keys, ...editing, ...(support === undefined ? [] : [support])] }
}

/**
 * One code file's body as a CodeMirror view. Created once on mount against a
 * host div (destroyed on unmount); the live text and reloads flow through the
 * imperative handle so re-renders never rebuild the editor or its cursor.
 */
export const CodeEditor = forwardRef<CodeEditorHandle, CodeEditorProps>(function CodeEditor(
  { content, language, editable = false, onDirtyChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // A reload dispatches a doc change the parent did not type; suppress its dirty signal.
  const suppressDirtyRef = useRef(false)
  const onDirtyRef = useRef(onDirtyChange)
  useEffect(() => { onDirtyRef.current = onDirtyChange })

  // Capture the first-render seed: the view is created once and never rebuilt
  // from props (reloads are imperative), so later prop changes must not recreate it.
  const initial = useRef({ content, language, editable }).current
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const { doc, extensions } = buildExtensions(initial.content, initial.language, initial.editable, () => {
      if (suppressDirtyRef.current) { suppressDirtyRef.current = false; return }
      onDirtyRef.current?.()
    })
    const view = new EditorView({ parent: host, state: EditorState.create({ doc, extensions }) })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
  }, [initial])

  useImperativeHandle(ref, () => ({
    getText: () => viewRef.current?.state.doc.toString() ?? '',
    reload: (text) => {
      const view = viewRef.current
      if (view === null) return
      suppressDirtyRef.current = true
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } })
    },
  }), [])

  return <div className={css.codeEditor} ref={hostRef} />
})
