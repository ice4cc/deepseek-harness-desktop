// @vitest-environment jsdom
/**
 * ThinkTagControl over the composer's live input machine: the trigger
 * reflects the draft's trailing tag, the dropdown rewrites it through the
 * public setDraft action, an untagged draft stays untouched, the menu
 * dismisses on outside mousedown or Escape, and a pick without the input
 * machine closes the menu without writing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { ThinkTagControl, type ThinkTagControlProps } from '../src/client/ThinkTagControl.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** The framework-injected t seat, stubbed over the zh dictionaries (the default locale). */
const t: ThinkTagControlProps['t'] = makeTranslate(zh, commonZh)

function draftState(draft: string): ThinkTagControlProps['input'] {
  return {
    draft,
    imageIds: [],
    draftRev: 1,
    phase: 'plain',
    occurrences: [],
    queue: [],
  }
}

function setup(draft: string, withActions: boolean = true) {
  const store = createSnapshotStore<ThinkTagControlProps['input']>(draftState(draft))
  const useInput = (selector?: (s: ThinkTagControlProps['input']) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s))
  const setDraft = vi.fn((next: string) => { store.set(draftState(next)) })
  const inputActions = withActions ? {
    setDraft,
    addImages: () => true,
    removeImage: () => {},
    pruneImages: () => {},
    submit: () => {},
  } : undefined
  const input = draftState(draft)
  const props = { useInput, inputActions, input, t } as unknown as ThinkTagControlProps
  const view = render(<ThinkTagControl {...props} />)
  return { store, setDraft, view }
}

const trigger = () => screen.getByRole('button', { name: '思考强度选择' })

describe('ThinkTagControl', () => {
  it('shows the session-default label for an untagged draft', () => {
    setup('你好')
    expect(trigger().textContent).toContain('跟随会话设置')
  })

  it('shows the active level while the draft carries a trailing tag', () => {
    setup('你好 <|think_xhigh|>')
    expect(trigger().textContent).toContain('深度思考')
  })

  it('opens the menu and appends the picked tag through setDraft', () => {
    const { setDraft } = setup('你好')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /深度思考/ }))
    expect(setDraft).toHaveBeenCalledTimes(1)
    expect(setDraft).toHaveBeenCalledWith('你好 <|think_xhigh|>')
  })

  it('replaces an existing tag when a different level is picked', () => {
    const { setDraft } = setup('你好 <|think_low|>')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /标准思考/ }))
    expect(setDraft).toHaveBeenCalledTimes(1)
    expect(setDraft).toHaveBeenCalledWith('你好 <|think_medium|>')
  })

  it('clears the tag back to plain text for the session-default choice', () => {
    const { setDraft } = setup('你好 <|think_low|>')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /跟随会话设置/ }))
    expect(setDraft).toHaveBeenCalledTimes(1)
    expect(setDraft).toHaveBeenCalledWith('你好')
  })

  it('is a no-op when the pick matches the current tag', () => {
    const { setDraft } = setup('你好 <|think_low|>')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /简洁思考/ }))
    expect(setDraft).not.toHaveBeenCalled()
  })

  it('keeps mid-draft tag text untouched (trailing tag only)', () => {
    const { setDraft } = setup('前文 <|think_xhigh|> 后文')
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /关闭思考/ }))
    expect(setDraft).toHaveBeenCalledWith('前文 <|think_xhigh|> 后文 <|think_off|>')
  })

  it('marks the active row checked in the open menu', () => {
    setup('你好 <|think_low|>')
    fireEvent.click(trigger())
    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.find(row => row.textContent?.includes('简洁思考'))?.getAttribute('aria-checked')).toBe('true')
  })

  it('closes the menu on Escape', () => {
    setup('你好')
    fireEvent.click(trigger())
    expect(screen.getByRole('menu', { name: '思考强度选项' })).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '思考强度选项' })).toBeNull()
  })

  it('keeps the menu open on non-Escape keys', () => {
    setup('你好')
    fireEvent.click(trigger())
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('menu', { name: '思考强度选项' })).toBeTruthy()
  })

  it('closes the menu on an outside mousedown', () => {
    setup('你好')
    fireEvent.click(trigger())
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu', { name: '思考强度选项' })).toBeNull()
  })

  it('keeps the menu open on a mousedown inside the control', () => {
    setup('你好')
    fireEvent.click(trigger())
    fireEvent.mouseDown(trigger())
    expect(screen.getByRole('menu', { name: '思考强度选项' })).toBeTruthy()
  })

  it('closes the menu without writing when the input machine is absent', () => {
    const { setDraft } = setup('你好', false)
    fireEvent.click(trigger())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /深度思考/ }))
    expect(setDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: '思考强度选项' })).toBeNull()
  })
})
