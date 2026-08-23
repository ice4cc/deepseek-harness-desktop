// @vitest-environment jsdom
/**
 * AppearanceSection: the width row renders the persisted level as the active
 * segmented option, a pick writes through setWidth, and the row re-renders
 * when the store moves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ContentWidthLevel } from '../src/appearance-settings.ts'
import { AppearanceSection, type AppearanceSectionProps } from '../src/client/AppearanceSection.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

/** The framework-injected t seat, stubbed over the zh dictionaries (the default locale). */
const t: AppearanceSectionProps['t'] = makeTranslate(zh, commonZh)

function setup(initial: ContentWidthLevel) {
  const store = createSnapshotStore<ContentWidthLevel>(initial)
  const useContentWidth = (selector?: (s: ContentWidthLevel) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s))
  const setWidth = vi.fn((level: ContentWidthLevel) => { store.set(level) })
  const props = { useContentWidth, setWidth, t } as unknown as AppearanceSectionProps
  render(<AppearanceSection {...props} />)
  return { store, setWidth }
}

const option = (label: string) => screen.getByRole('button', { name: label })

describe('AppearanceSection', () => {
  it('renders the title, description, and the three levels with standard active by default', () => {
    setup('standard')
    expect(screen.getByText('聊天内容宽度')).toBeTruthy()
    expect(screen.getByText(/调整对话消息列与输入卡片/)).toBeTruthy()
    expect(option('标准').getAttribute('aria-pressed')).toBe('true')
    expect(option('宽').getAttribute('aria-pressed')).toBe('false')
    expect(option('超宽').getAttribute('aria-pressed')).toBe('false')
  })

  it('marks the persisted level active', () => {
    setup('xwide')
    expect(option('超宽').getAttribute('aria-pressed')).toBe('true')
    expect(option('标准').getAttribute('aria-pressed')).toBe('false')
  })

  it('writes a pick through setWidth and follows the store move', () => {
    const { setWidth } = setup('standard')
    fireEvent.click(option('宽'))
    expect(setWidth).toHaveBeenCalledTimes(1)
    expect(setWidth).toHaveBeenCalledWith('wide')
    expect(option('宽').getAttribute('aria-pressed')).toBe('true')
    expect(option('标准').getAttribute('aria-pressed')).toBe('false')
  })

  it('re-renders when an external store change moves the level', () => {
    const { store } = setup('wide')
    expect(option('宽').getAttribute('aria-pressed')).toBe('true')
    act(() => { store.set('standard') })
    expect(option('标准').getAttribute('aria-pressed')).toBe('true')
    expect(option('宽').getAttribute('aria-pressed')).toBe('false')
  })
})
