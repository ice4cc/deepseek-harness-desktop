/**
 * Pure types of the file-changes domain: the ONE home of the `fileChanges`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod). Two namespace projections serve it — `./types` for
 * host consumers, `./client` for client aggregates — with zero content
 * duplication.
 *
 * @module @deepseek-ai/dsh-file-changes/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * One applied hunk of a file's most recent successful change, in the shape
 * the diff surface draws (the tool contract's `FileDiff`, redeclared here so
 * this package stays free of the tool dependency).
 */
export interface FileChangeDiff {
  /** The changed file's path as the tool recorded it (model-facing, unresolved). */
  path: string
  /** Prior content, or `null` for a new file / an overwrite with no prior side. */
  oldText: string | null
  /** Content after the change (the added side). */
  newText: string
}

/** One path's session-scoped change aggregation. */
export interface FileChangeEntry {
  /** The model-facing path recorded by the tool call, verbatim from the log. */
  path: string
  /** Successful edit/write results folded into this path. */
  edits: number
  /** Added lines summed over every folded change (context-cancelled multiset count). */
  added: number
  /** Removed lines summed over every folded change (context-cancelled multiset count). */
  removed: number
  /** Event time (ms epoch) of the most recent folded change. */
  lastAt: number
  /** The most recent change's hunks, text-truncated; null when it carried no diff. */
  lastDiff: FileChangeDiff[] | null
}

/**
 * The session's file-change aggregation, newest-touched path first. Bounded
 * by the unit (32 paths, truncated hunk text) so the wire value stays small
 * no matter how long the log grows; only successful `edit`/`write` tool
 * results contribute — a change made through any other surface (bash, a
 * manual edit) is invisible to this projection by design.
 */
export interface FileChangesProjection {
  /** Aggregated paths, most recently touched first. */
  files: FileChangeEntry[]
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Per-path aggregation of successful edit/write results; see {@link FileChangesProjection}. */
    fileChanges: FileChangesProjection
  }
}
