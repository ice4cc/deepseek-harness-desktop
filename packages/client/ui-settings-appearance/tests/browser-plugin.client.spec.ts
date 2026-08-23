// @vitest-environment jsdom
/**
 * ui-settings-appearance browser half on a real SlotRegistry: the plugin
 * occupies the settings-declared `settings.section` list seat, drives the
 * --dsh-chat-content-width override sheet from the durable level (adopting
 * external changes and writing picks back), and removes both the entry and
 * the sheet on teardown. The settings transport is mocked at the
 * settingsScope service boundary; the real binder's wire behavior belongs to
 * ui-settings' own suites.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { AppearanceSettings, ContentWidthLevel } from '../src/appearance-settings.ts'
import { AppearanceSection, type AppearanceSectionInjected } from '../src/client/AppearanceSection.tsx'
import { apply, inject } from '../src/client/index.ts'

/** A settings-scope double over one mutable durable value. */
function makeScope(initial?: AppearanceSettings) {
  const listeners = new Set<() => void>()
  let value: AppearanceSettings | undefined = initial
  return {
    getSnapshot: () => ({ status: 'ready' as const, value }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(async (_field: string, _value: unknown) => {}),
    /** Move the durable value the way a folded mirror settlement does. */
    publish(next: AppearanceSettings | undefined): void {
      value = next
      for (const listener of [...listeners]) listener()
    },
  }
}

async function bench(initial?: AppearanceSettings) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // The specs assert the shipped Chinese copy; stage zh explicitly.
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const scope = makeScope(initial)
  ctx.provide('settingsScope', { bind: () => scope } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, scope }
}

function declareRoot(slots: SlotRegistry): void {
  slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

const sheet = () => document.head.querySelector('style[data-plugin="@deepseek-ai/dsh-client-ui-settings-appearance"]')

describe('ui-settings-appearance browser apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'settingsScope'])
  })

  it('waits until settings declares the section seat, and empties it on teardown', async () => {
    const { ctx, slots } = await bench()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(0)
    declareRoot(slots)
    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })

  it('registers the appearance section with a locale-following nav label', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(AppearanceSection)
    expect(entry.options).toMatchObject({ id: 'appearance', order: 5 })
    expect(resolveSlotLabel(entry.options.label)).toBe('外观')
  })

  it('adopts the durable level, writes picks back, and follows external moves', async () => {
    const { ctx, slots, scope } = await bench({ contentWidth: 'wide' })
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    // The durable level is adopted at activation and drives the sheet.
    expect(sheet()?.textContent).toBe('div { --dsh-chat-content-width: 880px !important; }')
    const face = (slots.entries('settings.section')[0]!.inject as unknown as () => AppearanceSectionInjected)()
    expect(face.hooks.contentWidth.getSnapshot()).toBe<ContentWidthLevel>('wide')

    // A pick publishes live, writes the field back, and moves the sheet.
    face.setWidth('xwide')
    expect(scope.set).toHaveBeenCalledTimes(1)
    expect(scope.set).toHaveBeenCalledWith('contentWidth', 'xwide')
    expect(face.hooks.contentWidth.getSnapshot()).toBe<ContentWidthLevel>('xwide')
    expect(sheet()?.textContent).toBe('div { --dsh-chat-content-width: 1200px !important; }')

    // Re-picking the active level is a no-op on the wire.
    face.setWidth('xwide')
    expect(scope.set).toHaveBeenCalledTimes(1)

    // An external settings move (another browser, document edit) converges the row and the sheet.
    scope.publish({ contentWidth: 'standard' })
    expect(face.hooks.contentWidth.getSnapshot()).toBe<ContentWidthLevel>('standard')
    expect(sheet()).toBeNull()

    // Re-picking the adopted level is a no-op on the wire as well.
    face.setWidth('standard')
    expect(scope.set).toHaveBeenCalledTimes(1)

    await fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
    expect(sheet()).toBeNull()
  })

  it('keeps the shipped width while no durable value exists, and reuses one sheet across levels', async () => {
    const { ctx, slots, scope } = await bench(undefined)
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(sheet()).toBeNull()
    const face = (slots.entries('settings.section')[0]!.inject as unknown as () => AppearanceSectionInjected)()
    expect(face.hooks.contentWidth.getSnapshot()).toBe<ContentWidthLevel>('standard')

    face.setWidth('wide')
    const first = sheet()!
    expect(first.textContent).toBe('div { --dsh-chat-content-width: 880px !important; }')

    // A folded write echo with the same level leaves the existing sheet untouched.
    scope.publish({ contentWidth: 'wide' })
    expect(sheet()).toBe(first)
    expect(face.hooks.contentWidth.getSnapshot()).toBe<ContentWidthLevel>('wide')

    face.setWidth('xwide')
    expect(sheet()).toBe(first)
    expect(first.textContent).toBe('div { --dsh-chat-content-width: 1200px !important; }')

    await fiber.dispose()
    expect(sheet()).toBeNull()
  })
})
