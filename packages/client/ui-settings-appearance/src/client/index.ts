/**
 * Appearance settings plugin, browser half: registers the `appearance`
 * section over the settings-declared `settings.section` list seat. The chat
 * content width level is a durable preference in this package's settings
 * namespace; selecting a level above standard injects an override sheet for
 * ui-conversation's `--dsh-chat-content-width` axis (the composer card and
 * centering padding derive from the same variable and follow).
 */

import {
  createSnapshotStore, type ClientContext,
} from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the settings shell's SlotMap merge and the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  APPEARANCE_SETTINGS_NAMESPACE, CONTENT_WIDTH_FIELD, DEFAULT_CONTENT_WIDTH,
  type AppearanceSettings, type ContentWidthLevel,
} from '../appearance-settings.ts'
import { contentWidthCss } from './core.ts'
import { AppearanceSection, type AppearanceSectionInjected } from './AppearanceSection.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.appearance'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Mount the appearance section: dictionaries, the durable width level, and
 * the override sheet it drives.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-appearance: dictionaries')

  // Registration-time text (the nav label) reads through the bound translate
  // as a thunk, so it follows the active locale without re-registration.
  const t = ctx.locale.bind(NS)

  // The live level is plugin-lifetime state: the settings panel unmounts its
  // sections on close, so the row's store must outlive any single render.
  const widthStore = createSnapshotStore<ContentWidthLevel>(DEFAULT_CONTENT_WIDTH)
  const scope = ctx.settingsScope.bind<AppearanceSettings>({ namespace: APPEARANCE_SETTINGS_NAMESPACE })

  // The override sheet is owned by this plugin, not the section component:
  // closing settings must not reset the column width. Adoption (scope → store)
  // and CSS application (store → sheet) are separate: a local pick publishes
  // before its write round-trips, so adopting on that path would revert it
  // against the still-stale durable value.
  let sheet: HTMLStyleElement | undefined
  const adopt = (): void => {
    const section = scope.getSnapshot().value
    if (section !== undefined && widthStore.getSnapshot() !== section.contentWidth) {
      widthStore.set(section.contentWidth)
    }
  }
  const applyCss = (): void => {
    const cssText = contentWidthCss(widthStore.getSnapshot())
    if (cssText === undefined) {
      sheet?.remove()
      sheet = undefined
      return
    }
    if (sheet === undefined) {
      sheet = document.createElement('style')
      sheet.dataset.plugin = '@deepseek-ai/dsh-client-ui-settings-appearance'
      document.head.appendChild(sheet)
    }
    if (sheet.textContent !== cssText) sheet.textContent = cssText
  }
  ctx.effect(() => {
    adopt()
    applyCss()
    const off = scope.subscribe(() => {
      adopt()
      applyCss()
    })
    return () => {
      off()
      sheet?.remove()
      sheet = undefined
    }
  }, 'ui-settings-appearance: content-width override')

  const injected = (): AppearanceSectionInjected => ({
    hooks: { contentWidth: widthStore },
    setWidth: (level) => {
      if (widthStore.getSnapshot() === level) return
      widthStore.set(level)
      // Reflect the pick in the sheet immediately; the scope subscription
      // already covers external moves once its write folds back.
      applyCss()
      void scope.set(CONTENT_WIDTH_FIELD, level)
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'appearance',
    order: 5,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, AppearanceSection))
}
