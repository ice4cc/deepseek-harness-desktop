/**
 * Chat content width override core: pure mapping from the persisted level to
 * the CSS that widens the conversation column. The column width is owned by
 * ui-conversation's `--dsh-chat-content-width` custom property (shipped
 * default 748px, declared on the conversation root); the composer card width
 * and the centering padding derive from the same variable, so overriding it
 * widens the whole content axis consistently. `standard` injects nothing and
 * keeps the shipped value.
 */

import type { ContentWidthLevel } from '../appearance-settings.ts'

/** Override width per level; `standard` has none (the shipped default stands). */
export const CONTENT_WIDTH_PX: Record<ContentWidthLevel, number | undefined> = {
  standard: undefined,
  wide: 880,
  xwide: 1200,
}

/**
 * Build the override sheet for one level. The `!important` author declaration
 * beats the conversation root's own class-scoped declaration on that element;
 * the variable is only consumed inside the conversation column, so a broad
 * selector has no effect elsewhere.
 * @param level - the persisted width level.
 * @returns the stylesheet text, or undefined when the level keeps the shipped width.
 */
export function contentWidthCss(level: ContentWidthLevel): string | undefined {
  const px = CONTENT_WIDTH_PX[level]
  return px === undefined ? undefined : `div { --dsh-chat-content-width: ${px}px !important; }`
}
