/**
 * ui-think-tag browser half on a real SlotRegistry: the plugin occupies the
 * conversation-declared `conversation.input.right` list seat with the
 * think-tag control; teardown empties the seat entry (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { ThinkTagControl } from '../src/client/ThinkTagControl.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots }
}

describe('ui-think-tag browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the right seat', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(1)
    await fiber.dispose()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(0)
  })

  it('registers the control into the right seat and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.right')[0]!
    expect(entry.component).toBe(ThinkTagControl)
    expect(entry.options.id).toBe('think-tag')
    await fiber.dispose()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
  })
})
