/**
 * Think-tag plugin, browser half: registers the think-effort control as a
 * list entry of the conversation-declared `conversation.input.right` seat
 * (the tool row inside the composer card, before the model seat and send
 * button). The control rewrites the draft's trailing `<|think_*|>` tag
 * through the public setDraft action — the tag is model-visible draft
 * content (logged, replayed, shipped) that the chat template strips at
 * render time; no host-side state and no submission-pipeline hook.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { ThinkTagControl } from './ThinkTagControl.tsx'
import { en, zh, type ThinkTagKey } from './locales.ts'

export type { ThinkTagKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer think-tag control's copy. */
    thinkTag: ThinkTagKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'thinkTag'

/** Required services: the seat's slot registry and the locale registry. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register the think-tag control over the composer seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-think-tag: dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'think-tag',
    locale: NS,
  }, ThinkTagControl))
}
