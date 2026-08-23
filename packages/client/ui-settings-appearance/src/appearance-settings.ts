/** Appearance preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the appearance plugin. */
export const APPEARANCE_SETTINGS_NAMESPACE = 'ui-settings-appearance'

/** Field carrying the chat content width level. */
export const CONTENT_WIDTH_FIELD = 'contentWidth'

/** Width levels accepted at settings and UI boundaries. */
export const CONTENT_WIDTH_LEVELS = ['standard', 'wide', 'xwide'] as const

/** Selectable chat content width level; `standard` is the shipped default width. */
export type ContentWidthLevel = typeof CONTENT_WIDTH_LEVELS[number]

/** Default keeps the shipped conversation column width. */
export const DEFAULT_CONTENT_WIDTH: ContentWidthLevel = 'standard'

/** Durable appearance section shared by the Host schema and the browser scope. */
export interface AppearanceSettings {
  /** Chat content width level for the conversation column and composer card. */
  contentWidth: ContentWidthLevel
}

/** Durable appearance schema; also the wire envelope the browser scope validates against. */
export const AppearanceSettingsSchema: z<AppearanceSettings> = z.object({
  [CONTENT_WIDTH_FIELD]: z.union([...CONTENT_WIDTH_LEVELS]).default(DEFAULT_CONTENT_WIDTH),
})
