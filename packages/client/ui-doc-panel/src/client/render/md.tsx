/**
 * Line-based Markdown renderer for the document panel: headings, fenced code
 * (plain monospace — syntax highlighting lives in the CodeMirror code view),
 * inline code/bold/italic/links, lists, blockquotes, horizontal rules, and
 * paragraphs. It emits React elements only — never `innerHTML` — and whitelists
 * link targets to http(s)/mailto/schemeless-relative so a document can not
 * script the panel. Styling classes arrive as a parameter (CSS Modules stay
 * module-owned).
 *
 * @module @deepseek-ai/dsh-client-ui-doc-panel/src/client/render/md
 */

import { Fragment, type ReactNode } from 'react'

/** One inline run produced by the inline parser (text or a link). */
export type InlineRun =
  | { kind: 'text'; text: string; bold?: boolean; italic?: boolean }
  | { kind: 'code'; text: string }
  | { kind: 'link'; label: string; href: string }

/** The CSS classes the renderer applies (supplied by the view's module). */
export interface MarkdownClasses {
  /** Inline code segment. */
  code: string | undefined
}

/** Whether a link target is safe to render (http(s), mailto, or schemeless relative). */
export function isSafeHref(href: string): boolean {
  if (/^(https?:|mailto:)/i.test(href)) return true
  // Schemeless: relative paths, in-page anchors, and protocol-free targets.
  // A colon before the first / ? # names a scheme (javascript:, data:) — refuse it.
  /* v8 ignore next -- split with limit 1 always yields one element, so pop() cannot be undefined */
  const head = href.split(/[/?#]/, 1).pop() ?? ''
  return !head.includes(':')
}

/**
 * Parse one inline Markdown span into runs: `code` first (no formatting inside),
 * then **bold**, *italic*, and [label](href) links. Unmatched markers stay text.
 * @param text - the inline source.
 * @returns the ordered run list.
 */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = []
  // Order matters: code, then link, then bold, then italic; each consumes its match.
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const idx = match.index
    if (idx > last) runs.push({ kind: 'text', text: text.slice(last, idx) })
    const [full, codeText, linkLabel, linkHref, boldText, italicText] = match
    if (codeText !== undefined) {
      runs.push({ kind: 'code', text: codeText })
    } else if (linkLabel !== undefined && linkHref !== undefined) {
      runs.push(isSafeHref(linkHref) ? { kind: 'link', label: linkLabel, href: linkHref } : { kind: 'text', text: full })
    } else if (boldText !== undefined) {
      // The alternation sets exactly one emphasis group when code and link miss.
      runs.push({ kind: 'text', text: boldText, bold: true })
    } else {
      // Reaching this arm means code, link, and bold all missed, so the match
      // is an italic run (the alternation sets exactly one emphasis group).
      runs.push({ kind: 'text', text: italicText as string, italic: true })
    }
    last = idx + full.length
  }
  if (last < text.length) runs.push({ kind: 'text', text: text.slice(last) })
  return runs
}

/** Render one inline run list into React nodes. */
function renderInline(runs: InlineRun[], keyPrefix: string, cls: MarkdownClasses): ReactNode[] {
  const nodes: ReactNode[] = []
  runs.forEach((run, i) => {
    const key = `${keyPrefix}-${i}`
    if (run.kind === 'code') {
      nodes.push(<code key={key} className={cls.code}>{run.text}</code>)
    } else if (run.kind === 'link') {
      nodes.push(
        <a key={key} href={run.href} target="_blank" rel="noreferrer noopener">
          {run.label}
        </a>,
      )
    } else {
      // parseInline's alternation sets at most one emphasis flag per run.
      const text = run.text
      if (run.bold) nodes.push(<strong key={key}>{text}</strong>)
      else if (run.italic) nodes.push(<em key={key}>{text}</em>)
      else nodes.push(<Fragment key={key}>{text}</Fragment>)
    }
  })
  return nodes
}

/**
 * Render a Markdown document into React elements.
 * @param source - the full Markdown text.
 * @param cls - the CSS classes for code and tokenizer runs.
 * @returns the block-level element list (empty input yields an empty array).
 */
export function renderMarkdown(source: string, cls: MarkdownClasses): ReactNode[] {
  const lines = source.split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []

  /** Close the open paragraph, if any. */
  const flushPara = (): void => {
    if (para.length === 0) return
    const text = para.join(' ')
    para = []
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(parseInline(text), `p-${blocks.length}`, cls)}</p>)
  }

  let i = 0
  while (i < lines.length) {
    /* v8 ignore next -- i stays within [0, lines.length) by the loop bound */
    const line = lines[i] ?? ''
    // Fenced code block: collect until the closing fence (or EOF), rendered as
    // plain monospace (syntax highlighting lives in the CodeMirror code view).
    if (line.trimStart().startsWith('```')) {
      flushPara()
      const body: string[] = []
      i += 1
      while (i < lines.length) {
        /* v8 ignore next -- i stays within [0, lines.length) by the loop bound */
        const current = lines[i] ?? ''
        if (current.trimStart().startsWith('```')) break
        body.push(current)
        i += 1
      }
      i += 1 // consume the closing fence (or step past EOF harmlessly)
      blocks.push(
        <pre key={`pre-${blocks.length}`}>
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }
    // Heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushPara()
      /* v8 ignore next -- the heading pattern requires the hash group, so it matched */
      const level = (heading[1] ?? '').length
      /* v8 ignore next -- the heading pattern requires the text group, so it matched */
      const text = heading[2] ?? ''
      blocks.push(
        level === 1 ? <h1 key={`h-${blocks.length}`}>{renderInline(parseInline(text), `h-${blocks.length}`, cls)}</h1>
          : level === 2 ? <h2 key={`h-${blocks.length}`}>{renderInline(parseInline(text), `h-${blocks.length}`, cls)}</h2>
            : level === 3 ? <h3 key={`h-${blocks.length}`}>{renderInline(parseInline(text), `h-${blocks.length}`, cls)}</h3>
              : level === 4 ? <h4 key={`h-${blocks.length}`}>{renderInline(parseInline(text), `h-${blocks.length}`, cls)}</h4>
                : level === 5 ? <h5 key={`h-${blocks.length}`}>{renderInline(parseInline(text), `h-${blocks.length}`, cls)}</h5>
                  : <h6 key={`h-${blocks.length}`}>{renderInline(parseInline(text), `h-${blocks.length}`, cls)}</h6>,
      )
      i += 1
      continue
    }
    // Horizontal rule.
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushPara()
      blocks.push(<hr key={`hr-${blocks.length}`} />)
      i += 1
      continue
    }
    // Blockquote: collect consecutive '>' lines, render their content inline.
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length) {
        /* v8 ignore next -- i stays within [0, lines.length) by the loop bound */
        const current = lines[i] ?? ''
        if (!/^\s*>\s?/.test(current)) break
        quote.push(current.replace(/^\s*>\s?/, ''))
        i += 1
      }
      blocks.push(<blockquote key={`bq-${blocks.length}`}>{renderInline(parseInline(quote.join(' ')), `bq-${blocks.length}`, cls)}</blockquote>)
      continue
    }
    // Unordered list: collect consecutive '-'/'*'/'+' items.
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length) {
        /* v8 ignore next -- i stays within [0, lines.length) by the loop bound */
        const current = lines[i] ?? ''
        const item = /^\s*[-*+]\s+(.*)$/.exec(current)
        if (item === null) break
        /* v8 ignore next -- the list pattern requires the capture group */
        items.push(item[1] ?? '')
        i += 1
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((item, j) => <li key={j}>{renderInline(parseInline(item), `ul-${blocks.length}-${j}`, cls)}</li>)}
        </ul>,
      )
      continue
    }
    // Ordered list: collect consecutive 'N.' items.
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length) {
        /* v8 ignore next -- i stays within [0, lines.length) by the loop bound */
        const current = lines[i] ?? ''
        const item = /^\s*\d+\.\s+(.*)$/.exec(current)
        if (item === null) break
        /* v8 ignore next -- the list pattern requires the capture group */
        items.push(item[1] ?? '')
        i += 1
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {items.map((item, j) => <li key={j}>{renderInline(parseInline(item), `ol-${blocks.length}-${j}`, cls)}</li>)}
        </ol>,
      )
      continue
    }
    // Blank line: paragraph boundary.
    if (line.trim() === '') {
      flushPara()
      i += 1
      continue
    }
    // Ordinary paragraph line.
    para.push(line.trim())
    i += 1
  }
  flushPara()
  return blocks
}
