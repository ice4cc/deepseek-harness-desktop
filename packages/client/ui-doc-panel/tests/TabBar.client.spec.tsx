// @vitest-environment jsdom
/**
 * TabBar presentation behavior: the pinned changes tab (badge, active state),
 * file tabs with close buttons, and click routing. Feeds props directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DocTab } from '../src/client/store.ts'
import { TabBar } from '../src/client/TabBar.tsx'
import { en } from '../src/client/locales.ts'

const t = (key: string): string => (en as Record<string, string>)[key] ?? key

afterEach(() => { cleanup() })

function tab(path: string, title: string, dirty = false): DocTab {
  return { path, title, kind: 'code', loading: false, dirty, saving: false }
}

describe('TabBar', () => {
  it('shows the pinned changes tab active by default with a count badge', () => {
    render(
      <TabBar
        tabPaths={['/a/one.ts']} tabs={{ '/a/one.ts': tab('/a/one.ts', 'one.ts') }}
        activeId={null} changesCount={3} onActivate={vi.fn()} onClose={vi.fn()} t={t}
      />,
    )
    const changes = screen.getByRole('tab', { name: /Changes/ })
    expect(changes.getAttribute('aria-selected')).toBe('true')
    expect(changes.textContent).toContain('3')
  })

  it('omits the badge when there are no changes', () => {
    render(
      <TabBar
        tabPaths={[]} tabs={{}} activeId="changes" changesCount={0}
        onActivate={vi.fn()} onClose={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('tab', { name: 'Changes' }).textContent).not.toContain('0')
  })

  it('activates file tabs and the changes tab on click', () => {
    const onActivate = vi.fn()
    render(
      <TabBar
        tabPaths={['/a/one.ts']} tabs={{ '/a/one.ts': tab('/a/one.ts', 'one.ts') }}
        activeId="/a/one.ts" changesCount={0} onActivate={onActivate} onClose={vi.fn()} t={t}
      />,
    )
    expect(screen.getByRole('tab', { name: /one\.ts/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'one.ts' }))
    expect(onActivate).toHaveBeenCalledWith('/a/one.ts')
    fireEvent.click(screen.getByRole('tab', { name: 'Changes' }))
    expect(onActivate).toHaveBeenLastCalledWith('changes')
  })

  it('closes a file tab via its close button without activating it', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    render(
      <TabBar
        tabPaths={['/a/one.ts']} tabs={{ '/a/one.ts': tab('/a/one.ts', 'one.ts') }}
        activeId="/a/one.ts" changesCount={0} onActivate={onActivate} onClose={onClose} t={t}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }))
    expect(onClose).toHaveBeenCalledWith('/a/one.ts')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('skips paths whose tab is missing from the cache', () => {
    render(
      <TabBar
        tabPaths={['/ghost']} tabs={{}} activeId={null} changesCount={0}
        onActivate={vi.fn()} onClose={vi.fn()} t={t}
      />,
    )
    expect(screen.queryByRole('tab', { name: /ghost/ })).toBeNull()
  })

  it('marks a dirty tab and leaves a clean one unmarked', () => {
    const { container } = render(
      <TabBar
        tabPaths={['/a/dirty.ts', '/a/clean.ts']}
        tabs={{ '/a/dirty.ts': tab('/a/dirty.ts', 'dirty.ts', true), '/a/clean.ts': tab('/a/clean.ts', 'clean.ts') }}
        activeId="/a/dirty.ts" changesCount={0} onActivate={vi.fn()} onClose={vi.fn()} t={t}
      />,
    )
    const dirtyTab = screen.getByRole('tab', { name: /dirty\.ts/ })
    const cleanTab = screen.getByRole('tab', { name: /clean\.ts/ })
    expect(dirtyTab.textContent).toContain('●')
    expect(cleanTab.textContent).not.toContain('●')
    // The marker is decorative (hidden from the accessibility tree).
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(1)
  })
})
