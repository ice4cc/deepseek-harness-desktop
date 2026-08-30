/** Document panel slot registration into the docPanel column seat and its read/transition callbacks. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TextFileReadError, TextFileWriteError } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-doc-panel/client'
import type { DocPanelInjected } from '@deepseek-ai/dsh-client-ui-doc-panel/client'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const workspaces = { readTextFile: vi.fn(), writeTextFile: vi.fn() }
  const layout = { openDocPanel: vi.fn(), closeDocPanel: vi.fn() }
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('layout', layout as never)
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    // The layout-owned seat the panel registers into (AppFrame declares it).
    slots.register(
      { name: 'root', children: { 'docPanel': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots, workspaces, layout }
}

describe('ui-doc-panel apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'workspaces', 'locale', 'layout'])
  })

  it('registers the column entry with store, locale seat, and injected callbacks', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('docPanel')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.locale).toBe('docPanel')
    // The exclusive factory is minted into a per-entry handle at register time.
    const store = entry.store as unknown as { create(): unknown } | undefined
    expect(typeof store?.create).toBe('function')

    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(null)
    expect(Object.keys(injected)).toEqual(['readFile', 'saveFile', 'openPanel', 'closePanel'])
  })

  it('routes panel transitions through the ctx.layout face', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('docPanel')[0]!
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(null)
    injected.openPanel()
    injected.closePanel()
    expect(b.layout.openDocPanel).toHaveBeenCalledTimes(1)
    expect(b.layout.closeDocPanel).toHaveBeenCalledTimes(1)
  })

  it('lands a successful read on the store via setTabContent and the baseline version', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.workspaces.readTextFile.mockResolvedValue({ path: '/a/one.md', content: '# hi\n', size: 5, version: 'v1' })
    const entry = b.slots.entries('docPanel')[0]!
    const actions = { setTabContent: vi.fn(), setTabError: vi.fn(), setBaseline: vi.fn() }
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(actions)
    const result = await injected.readFile('/a/one.md')
    expect(actions.setTabContent).toHaveBeenCalledWith('/a/one.md', '# hi\n')
    expect(actions.setBaseline).toHaveBeenCalledWith('/a/one.md', 'v1')
    expect(b.workspaces.readTextFile).toHaveBeenCalledWith('/a/one.md')
    // The read resolves with the decoded content and baseline for a conflict reload.
    expect(result).toEqual({ ok: true, content: '# hi\n', version: 'v1' })
  })

  it('writes a save through writeTextFile with the expected-version guard', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.workspaces.writeTextFile.mockResolvedValue({ path: '/a/x.ts', version: 'v2', size: 9 })
    const entry = b.slots.entries('docPanel')[0]!
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(null)
    const result = await injected.saveFile('/a/x.ts', 'let n = 1\n', 'v1')
    expect(b.workspaces.writeTextFile).toHaveBeenCalledWith('/a/x.ts', 'let n = 1\n', 'v1')
    expect(result).toEqual({ ok: true, version: 'v2', size: 9 })
  })

  it('resolves a stale save as the file-stale-version code (not a throw)', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.workspaces.writeTextFile.mockRejectedValue(
      new TextFileWriteError({ code: 'file-stale-version', message: 'stale' } as never),
    )
    const entry = b.slots.entries('docPanel')[0]!
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(null)
    const result = await injected.saveFile('/a/x.ts', 'let n = 1\n', 'v1')
    expect(result).toEqual({ ok: false, code: 'file-stale-version' })
  })

  it('resolves an unexpected save failure as the internal code', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.workspaces.writeTextFile.mockRejectedValue(new Error('boom'))
    const entry = b.slots.entries('docPanel')[0]!
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(null)
    const result = await injected.saveFile('/a/x.ts', 'let n = 1\n')
    expect(result).toEqual({ ok: false, code: 'internal' })
  })

  it('lands a structured browse failure as its wire code', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.workspaces.readTextFile.mockRejectedValue(
      new TextFileReadError({ code: 'file-too-large', message: 'too big' } as never),
    )
    const entry = b.slots.entries('docPanel')[0]!
    const actions = { setTabContent: vi.fn(), setTabError: vi.fn() }
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(actions)
    injected.readFile('/a/big.bin')
    await vi.waitFor(() => { expect(actions.setTabError).toHaveBeenCalledWith('/a/big.bin', 'file-too-large') })
    expect(actions.setTabContent).not.toHaveBeenCalled()
  })

  it('lands an unexpected failure as the internal code', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    b.workspaces.readTextFile.mockRejectedValue(new Error('boom'))
    const entry = b.slots.entries('docPanel')[0]!
    const actions = { setTabContent: vi.fn(), setTabError: vi.fn() }
    const injected = (entry.inject as (actions: unknown) => DocPanelInjected)(actions)
    injected.readFile('/a/one.md')
    await vi.waitFor(() => { expect(actions.setTabError).toHaveBeenCalledWith('/a/one.md', 'internal') })
  })

  it('waits for a late docPanel declaration and installs on arrival', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    // No live owner yet: the injection stays pending, nothing registers.
    expect(b.slots.entries('docPanel')).toHaveLength(0)

    // The layout owner declares the seat (boot order is unconstrained).
    b.slots.register(
      { name: 'root', children: { 'docPanel': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
    expect(b.slots.entries('docPanel')).toHaveLength(1)
  })

  it('removes the column entry when the declaring owner collapses', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const disposeOwner = b.slots.register(
      { name: 'root', children: { 'docPanel': { kind: 'single', scope: 'root' } } } as never,
      () => null,
    )
    expect(b.slots.entries('docPanel')).toHaveLength(1)
    disposeOwner()
    expect(b.slots.entries('docPanel')).toHaveLength(0)
  })

  it('removes the column entry on plugin teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.slots.entries('docPanel')).toHaveLength(1)
    await fiber.dispose()
    expect(b.slots.entries('docPanel')).toHaveLength(0)
  })
})
