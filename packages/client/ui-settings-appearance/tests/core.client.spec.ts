/** Pure width-level to override-sheet mapping. */
import { describe, expect, it } from 'vitest'
import { CONTENT_WIDTH_PX, contentWidthCss } from '../src/client/core.ts'

describe('contentWidthCss', () => {
  it('keeps the shipped width for standard (no sheet)', () => {
    expect(CONTENT_WIDTH_PX.standard).toBeUndefined()
    expect(contentWidthCss('standard')).toBeUndefined()
  })

  it('overrides --dsh-chat-content-width for wide and xwide', () => {
    expect(contentWidthCss('wide')).toBe('div { --dsh-chat-content-width: 880px !important; }')
    expect(contentWidthCss('xwide')).toBe('div { --dsh-chat-content-width: 1200px !important; }')
  })

  it('is stable across repeated calls for the same level', () => {
    expect(contentWidthCss('wide')).toBe(contentWidthCss('wide'))
  })
})
