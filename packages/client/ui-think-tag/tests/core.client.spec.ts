import { describe, expect, it } from 'vitest'
import { setThinkLevel, thinkLevelOf, thinkTagOf, THINK_LEVELS } from '../src/client/core.ts'

describe('thinkTagOf', () => {
  it('spells each level as the template control tag', () => {
    expect(thinkTagOf('off')).toBe('<|think_off|>')
    expect(thinkTagOf('low')).toBe('<|think_low|>')
    expect(thinkTagOf('medium')).toBe('<|think_medium|>')
    expect(thinkTagOf('xhigh')).toBe('<|think_xhigh|>')
  })
})

describe('thinkLevelOf', () => {
  it('parses a trailing tag with tolerated whitespace', () => {
    expect(thinkLevelOf('你好 <|think_xhigh|>')).toBe('xhigh')
    expect(thinkLevelOf('你好 <|think_low|>  ')).toBe('low')
    expect(thinkLevelOf('<|think_off|>')).toBe('off')
  })

  it('stays null for drafts without a trailing tag', () => {
    expect(thinkLevelOf('')).toBe(null)
    expect(thinkLevelOf('普通消息')).toBe(null)
    // A mid-draft tag is not a control tag: the draft text owns it.
    expect(thinkLevelOf('前文 <|think_xhigh|> 后文')).toBe(null)
    expect(thinkLevelOf('前文 <|think_bogus|>')).toBe(null)
  })
})

describe('setThinkLevel', () => {
  it('appends a tag to an untagged draft with one separator space', () => {
    expect(setThinkLevel('你好', 'xhigh')).toBe('你好 <|think_xhigh|>')
    expect(setThinkLevel('你好  ', 'xhigh')).toBe('你好 <|think_xhigh|>')
  })

  it('returns the tag alone for an empty draft', () => {
    expect(setThinkLevel('', 'low')).toBe('<|think_low|>')
  })

  it('replaces an existing trailing tag without duplicating', () => {
    expect(setThinkLevel('你好 <|think_low|>', 'xhigh')).toBe('你好 <|think_xhigh|>')
    expect(setThinkLevel('你好 <|think_low|>  ', 'xhigh')).toBe('你好 <|think_xhigh|>')
  })

  it('clears the tag back to plain text (trailing space trimmed)', () => {
    expect(setThinkLevel('你好 <|think_xhigh|>', null)).toBe('你好')
    expect(setThinkLevel('<|think_off|>', null)).toBe('')
  })

  it('is a no-op when the request matches the current tag', () => {
    const draft = '你好 <|think_low|>'
    expect(setThinkLevel(draft, 'low')).toBe(draft)
    expect(setThinkLevel('你好', null)).toBe('你好')
  })

  it('covers every menu level round-trip', () => {
    for (const level of THINK_LEVELS) {
      const draft = setThinkLevel('任务', level)
      expect(thinkLevelOf(draft)).toBe(level)
      expect(setThinkLevel(draft, null)).toBe('任务')
    }
  })
})
