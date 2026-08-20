/**
 * Think-tag draft manipulation core: pure functions mapping a draft against
 * the inline `<|think_*|>` tags the chat template strips at render time. The
 * tag rides the DRAFT itself (model-visible content is logged draft content),
 * so the input machine, the transcript, and the wire payload all carry it
 * without any submission-pipeline hook.
 */

/** Think effort levels the froggeric chat template accepts inline. */
export type ThinkLevel = 'off' | 'low' | 'medium' | 'xhigh'

/** All selectable levels in menu order. */
export const THINK_LEVELS: readonly ThinkLevel[] = ['off', 'low', 'medium', 'xhigh']

/**
 * The inline tag spelling for one level (template control tag, not model prose).
 * @param level - The level to spell.
 * @returns The inline `<|think_...|>` tag for `level`.
 */
export function thinkTagOf(level: ThinkLevel): string {
  return `<|think_${level}|>`
}

const TAG_RE = /<\|think_(off|low|medium|xhigh)\|>\s*$/u

/**
 * Parse the trailing think tag out of a draft.
 * @param draft - the live composer draft.
 * @returns the level when the draft ends with one tag (trailing whitespace
 * tolerated); null when no tag is present.
 */
export function thinkLevelOf(draft: string): ThinkLevel | null {
  const match = TAG_RE.exec(draft)
  return match === null ? null : (match[1] as ThinkLevel)
}

/**
 * Rewrite the draft's trailing think tag to one level, or remove it for null.
 * Only the trailing span is touched; user text mid-draft is never scanned.
 * @param draft - the live composer draft.
 * @param level - the level to install, or null to clear any tag.
 * @returns the next draft; identical to `draft` when the request is a no-op.
 */
export function setThinkLevel(draft: string, level: ThinkLevel | null): string {
  const base = TAG_RE.exec(draft) === null ? draft : draft.replace(TAG_RE, '')
  const trimmed = base.replace(/\s+$/u, '')
  if (level === null) return trimmed
  return trimmed === '' ? thinkTagOf(level) : `${trimmed} ${thinkTagOf(level)}`
}
