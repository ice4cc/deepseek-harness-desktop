/** Host registration for the appearance preference. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { APPEARANCE_SETTINGS_NAMESPACE, AppearanceSettingsSchema } from './appearance-settings.ts'

export {
  APPEARANCE_SETTINGS_NAMESPACE, CONTENT_WIDTH_FIELD, CONTENT_WIDTH_LEVELS,
  DEFAULT_CONTENT_WIDTH, type AppearanceSettings, type ContentWidthLevel,
} from './appearance-settings.ts'
export { AppearanceSettingsSchema } from './appearance-settings.ts'

/**
 * Register the durable appearance section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      APPEARANCE_SETTINGS_NAMESPACE,
      AppearanceSettingsSchema,
    )
  })
}
