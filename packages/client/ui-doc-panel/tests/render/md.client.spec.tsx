// @vitest-environment jsdom
/**
 * renderMarkdown unit account: block structure (headings, fences, lists,
 * quotes, rules, paragraphs), inline runs (code/bold/italic/links), and the
 * link-target whitelist. Asserts on the rendered HTML markup — behavior, not
 * element identity.
 */
import { Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { isSafeHref, parseInline, renderMarkdown } from '@deepseek-ai/dsh-client-ui-doc-panel/src/client/render/md.tsx'

/** The fixed class table for markup assertions. */
const CLS = { code: 'code' }

/** Render a document to its static HTML string. */
function html(source: string): string {
  return renderToStaticMarkup(<Fragment>{renderMarkdown(source, CLS)}</Fragment>)
}

describe('isSafeHref', () => {
  it('allows http(s) and mailto targets', () => {
    expect(isSafeHref('https://example.com/a')).toBe(true)
    expect(isSafeHref('HTTP://EXAMPLE.COM')).toBe(true)
    expect(isSafeHref('mailto:dev@example.com')).toBe(true)
  })

  it('allows schemeless relative paths, anchors, and query strings', () => {
    expect(isSafeHref('/docs/guide.md')).toBe(true)
    expect(isSafeHref('./local/notes.md')).toBe(true)
    expect(isSafeHref('#section-2')).toBe(true)
    expect(isSafeHref('page.html?x=1')).toBe(true)
  })

  it('refuses named schemes (javascript:, data:) wherever the colon sits', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('data:text/html,<script>')).toBe(false)
    expect(isSafeHref('foo:bar/baz')).toBe(false)
  })
})

describe('parseInline', () => {
  it('parses code, bold, italic, and links in order of appearance', () => {
    const runs = parseInline('a **b** *c* `d` [e](https://x.y) f')
    expect(runs).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'text', text: 'b', bold: true },
      { kind: 'text', text: ' ' },
      { kind: 'text', text: 'c', italic: true },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
      { kind: 'text', text: ' ' },
      { kind: 'link', label: 'e', href: 'https://x.y' },
      { kind: 'text', text: ' f' },
    ])
  })

  it('keeps unmatched markers as literal text', () => {
    expect(parseInline('a * b and [no-link] here')).toEqual([
      { kind: 'text', text: 'a * b and [no-link] here' },
    ])
  })

  it('downgrades unsafe link targets to plain text', () => {
    // The href match stops at the first ')', so the downgrade keeps the
    // matched span literal and the trailing ')' lands as its own run.
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1)' },
      { kind: 'text', text: ')' },
    ])
  })
})

describe('renderMarkdown', () => {
  it('renders all heading levels', () => {
    expect(html('# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6'))
      .toBe('<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>')
  })

  it('renders fenced code as plain monospace, with or without a language hint', () => {
    const out = html('```js\nlet n = 1 // c\n```\n```plain\nx\n```')
    expect(out).toContain('<pre><code>let n = 1 // c</code></pre>')
    expect(out).toContain('<pre><code>x</code></pre>')
    // Both fences render as plain pre/code — no token spans.
    expect(out.match(/<pre><code>/g)).toHaveLength(2)
    expect(out).not.toContain('tok-')

    // A fence with no language word at all takes the same plain path.
    const bare = html('```\nx\n```')
    expect(bare).toContain('<pre><code>x</code></pre>')
  })

  it('closes an unterminated fence at EOF', () => {
    const out = html('```js\nlet a = 1')
    expect(out).toContain('<pre><code>let a = 1</code></pre>')
  })

  it('renders horizontal rule variants and blockquotes', () => {
    expect(html('---')).toBe('<hr/>')
    expect(html('***')).toBe('<hr/>')
    expect(html('___')).toBe('<hr/>')
    expect(html('> quoted line\n> more')).toBe('<blockquote>quoted line more</blockquote>')
  })

  it('renders unordered and ordered lists with inline content', () => {
    expect(html('- a **b**\n- c')).toBe('<ul><li>a <strong>b</strong></li><li>c</li></ul>')
    expect(html('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>')
  })

  it('ends quotes and lists at the first non-matching line', () => {
    expect(html('> quoted\nplain after')).toBe('<blockquote>quoted</blockquote><p>plain after</p>')
    expect(html('- item\ntail text')).toBe('<ul><li>item</li></ul><p>tail text</p>')
    expect(html('1. one\ntail text')).toBe('<ol><li>one</li></ol><p>tail text</p>')
  })

  it('joins consecutive paragraph lines and separates on blanks', () => {
    expect(html('one two\nthree\n\nfour')).toBe('<p>one two three</p><p>four</p>')
  })

  it('renders inline code, bold, italic, and safe links with rel hardening', () => {
    const out = html('`code` **bold** *it* [ok](https://x.y) [bad](javascript:alert(1))')
    expect(out).toContain('<code class="code">code</code>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>it</em>')
    expect(out).toContain('<a href="https://x.y" target="_blank" rel="noreferrer noopener">ok</a>')
    // The unsafe target renders as literal text, never an anchor.
    expect(out).toContain('[bad](javascript:alert(1))')
    expect(out).not.toContain('href="javascript:')
  })

  it('renders empty input as no blocks', () => {
    expect(renderMarkdown('', CLS)).toEqual([])
    expect(html('')).toBe('')
  })

  it('mixes blocks in document order (paragraph, fence, list)', () => {
    const out = html('intro\n```js\nlet a = 1\n```\n- item')
    const parts = ['<p>intro</p>', '<pre><code>', '<ul><li>item</li></ul>']
    let pos = -1
    for (const part of parts) {
      const next = out.indexOf(part, pos + 1)
      expect(next).toBeGreaterThan(pos)
      pos = next
    }
  })
})
