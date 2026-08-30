/** Registers the document panel into the layout-owned docPanel column seat. */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the Workspace Controller's Context merge (ctx.workspaces).
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls ui-layout's Context merge (ctx.layout) for the panel actions.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocPanelInjected } from './contract/slots.ts'
import { DocPanelRoot } from './DocPanelRoot.tsx'
import { en, zh, type DocPanelKey } from './locales.ts'
import { createDocPanelStore } from './store.ts'

export type { DocPanelInjected, DocPanelRootComponentProps } from './contract/slots.ts'
export type { DocPanelKey } from './locales.ts'
export { createDocPanelStore } from './store.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Document panel controls copy. */
    docPanel: DocPanelKey
  }
}

/** Dictionary namespace owned by this plugin (panel controls copy). */
const NS = 'docPanel'

/** Services required by the document panel plugin. */
export const inject = ['slots', 'workspaces', 'locale', 'layout']

/**
 * Wire failure code from a workspaces text-file rejection; a structured
 * failure carries `{ rpcError: { code } }`, anything else is internal.
 * @param error - the caught rejection value.
 */
function wireCode(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'rpcError' in error) {
    const rpcError = error.rpcError
    if (rpcError !== null && typeof rpcError === 'object' && 'code' in rpcError
      && typeof rpcError.code === 'string') return rpcError.code
  }
  return 'internal'
}

/** Registers the panel entry and its read/transition callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-doc-panel: dictionaries')

  const injectProps = (actions: BoundActions<ReturnType<typeof createDocPanelStore>>): DocPanelInjected => ({
    // The read lands on the tab through the store (content + baseline); a
    // structured browse failure surfaces its wire code so the tab can name it.
    // It resolves once settled so a conflict reload can await the fresh bytes.
    readFile: async (path) => {
      try {
        const content = await ctx.workspaces.readTextFile(path)
        actions.setTabContent(path, content.content)
        actions.setBaseline(path, content.version)
        return { ok: true as const, content: content.content, version: content.version }
      } catch (error: unknown) {
        const code = wireCode(error)
        actions.setTabError(path, code)
        return { ok: false as const, code }
      }
    },
    // The save writes the editor's full text; a stale guard or any other Host
    // business failure resolves with its wire code so the tab can branch on it.
    saveFile: async (path, content, expectedVersion) => {
      try {
        const written = await ctx.workspaces.writeTextFile(path, content, expectedVersion)
        return { ok: true as const, version: written.version, size: written.size }
      } catch (error: unknown) {
        const code = wireCode(error)
        return { ok: false as const, code }
      }
    },
    // Column geometry lives in the layout store; the panel transitions ride
    // the cross-plugin ctx.layout face.
    openPanel: () => { ctx.layout.openDocPanel() },
    closePanel: () => { ctx.layout.closeDocPanel() },
  })
  ctx.effect(
    () => ctx.slots.inject('docPanel', () => ctx.slots.register({
      name: 'docPanel',
      locale: NS,
      // Exclusive store: the factory itself — the framework instantiates per scope.
      store: createDocPanelStore,
      inject: injectProps,
    }, DocPanelRoot)),
    'ui-doc-panel: column registration',
  )
}
