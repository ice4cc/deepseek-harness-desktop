/**
 * Function plugin registering the `fileChanges` projection unit: a bounded
 * per-path aggregation of successful edit/write tool results served through
 * the session-projection seam (registry snapshot, change feed, and every
 * projection carrier), so clients render the session's change list that
 * paging and compaction cannot change. The plugin owns only the fold;
 * delivery is the seam's.
 *
 * @module @deepseek-ai/dsh-file-changes
 */

import type { Context } from '@deepseek-ai/cordis'
import { fileChangesProjectionDefinition } from './projection.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'file-changes'
/** The projection registry is the plugin's whole purpose; without it the fiber stays pending. */
export const inject = ['sessionProjections']

/**
 * Register the `fileChanges` unit; the registration is an effect on this
 * plugin's fiber, so unloading removes the key.
 * @param ctx - registrant context carrying the projection registry.
 */
export function apply(ctx: Context): void {
  ctx.sessionProjections.register(fileChangesProjectionDefinition)
}
