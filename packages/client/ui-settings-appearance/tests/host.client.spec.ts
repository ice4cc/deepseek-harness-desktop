/** Node half: the durable appearance section on a real settings provider. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  APPEARANCE_SETTINGS_NAMESPACE, DEFAULT_CONTENT_WIDTH, apply,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-settings-appearance host', () => {
  it('registers, validates, and disposes the durable width preference', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(APPEARANCE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ contentWidth: DEFAULT_CONTENT_WIDTH })
    await ctx.settings.update(ns, { contentWidth: 'wide' })
    expect(ctx.settings.get(ns)).toEqual({ contentWidth: 'wide' })
    await expect(ctx.settings.update(ns, { contentWidth: 'invalid' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('stays inert when no settings provider exists', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    await fiber.dispose()
  })
})
