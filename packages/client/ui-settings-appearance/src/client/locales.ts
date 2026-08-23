/** Locale dictionaries for the appearance settings section. */

import type { ContentWidthLevel } from '../appearance-settings.ts'

/** The settings.appearance locale namespace's key type. */
export type AppearanceSettingsKey =
  | 'nav'
  | 'title'
  | 'description'
  | 'level.standard'
  | 'level.wide'
  | 'level.xwide'

/** Chinese dictionary. */
export const zh: Record<AppearanceSettingsKey, string> = {
  nav: '外观',
  title: '聊天内容宽度',
  description: '调整对话消息列与输入卡片的显示宽度，标准即当前默认宽度',
  'level.standard': '标准',
  'level.wide': '宽',
  'level.xwide': '超宽',
}

/** English dictionary. */
export const en: Record<AppearanceSettingsKey, string> = {
  nav: 'Appearance',
  title: 'Chat content width',
  description: 'Adjusts the display width of the conversation column and composer card; Standard is the current default',
  'level.standard': 'Standard',
  'level.wide': 'Wide',
  'level.xwide': 'Extra wide',
}

/** Locale key per width level. */
const LEVEL_KEYS: Record<ContentWidthLevel, AppearanceSettingsKey> = {
  standard: 'level.standard',
  wide: 'level.wide',
  xwide: 'level.xwide',
}

/**
 * Resolve the locale key rendered for one width level.
 * @param level - the width level to label.
 * @returns the `level.*` dictionary key for that level.
 */
export function levelKey(level: ContentWidthLevel): AppearanceSettingsKey {
  return LEVEL_KEYS[level]
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The appearance settings section's copy. */
    'settings.appearance': AppearanceSettingsKey
  }
}
