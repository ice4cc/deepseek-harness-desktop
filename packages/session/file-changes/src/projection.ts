/**
 * The `fileChanges` projection unit: a bounded per-path fold of successful
 * `edit`/`write` tool results into the session's change aggregation.
 *
 * `tool/call` — not `tool/result` — is where the tool name and raw arguments
 * live (the result event carries only the callId), so edit/write calls are
 * parked in `pending` by callId until their result lands; a result with no
 * recorded call, or an errored one, contributes nothing. The line counts are
 * a context-cancelled multiset difference over each hunk's old/new sides:
 * context lines appear on both sides and cancel, leaving exactly the changed
 * lines (the same line-terminator rule the diff surface applies).
 *
 * Boundedness is part of the contract: at most {@link MAX_FILES} paths
 * (LRU-evicted by touch order), at most {@link MAX_DIFF_HUNKS} hunks per
 * retained diff, and each hunk side truncated to {@link MAX_DIFF_CHARS}.
 *
 * @module @deepseek-ai/dsh-file-changes/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { FileChangeDiff } from './types.ts'

/** LRU bound of aggregated paths (the wire value stays small in long sessions). */
export const MAX_FILES = 32
/** Hunk-side text bound before truncation. */
export const MAX_DIFF_CHARS = 8000
/** Hunk count bound per retained diff. */
export const MAX_DIFF_HUNKS = 40

/** One path's fold state (the view entry minus its key). */
interface FileChangeStateEntry {
  edits: number
  added: number
  removed: number
  lastAt: number
  lastDiff: FileChangeDiff[] | null
}

/**
 * Fold state: the per-path aggregation, its LRU touch order (oldest first),
 * and the edit/write calls awaiting their result. Plain JSON per the unit
 * contract (persisted-cache precondition).
 */
interface FileChangesState {
  files: Record<string, FileChangeStateEntry>
  order: string[]
  pending: Record<string, { tool: 'edit' | 'write'; path: string; content?: string }>
}

const fileChangeDiffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
}).strict()

const fileChangesSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    edits: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    lastAt: z.number(),
    lastDiff: z.array(fileChangeDiffSchema).nullable(),
  }).strict()),
}).strict()

/**
 * Split a side's text into its content lines, mirroring the diff surface's
 * terminator rule: empty text is zero lines, and a single trailing newline is
 * a line terminator rather than an extra empty line.
 * @param text - one side's text.
 * @returns the content lines, without the terminating newline.
 */
function contentLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/**
 * Count a hunk's changed lines as the context-cancelled multiset difference
 * of its two sides: every line present on both sides (context) cancels, so
 * what remains is exactly the added/removed lines.
 * @param oldText - the removed side, or null for a new file.
 * @param newText - the added side.
 * @returns the changed-line counts.
 */
function changedLines(oldText: string | null, newText: string): { added: number; removed: number } {
  const newLines = contentLines(newText)
  if (oldText === null) return { added: newLines.length, removed: 0 }
  const counts = new Map<string, number>()
  for (const line of contentLines(oldText)) counts.set(line, (counts.get(line) ?? 0) + 1)
  let added = 0
  for (const line of newLines) {
    const count = counts.get(line) ?? 0
    if (count > 0) counts.set(line, count - 1)
    else added++
  }
  let removed = 0
  for (const count of counts.values()) removed += count
  return { added, removed }
}

/** Whether `value` is a valid {@link FileChangeDiff} (defensive narrowing from opaque `meta`). */
function isFileDiff(value: unknown): value is FileChangeDiff {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, oldText, newText } = value as Record<string, unknown>
  return typeof path === 'string'
    && (oldText === null || typeof oldText === 'string')
    && typeof newText === 'string'
}

/**
 * Narrow opaque result metadata to non-empty file diffs. Malformed metadata
 * returns `undefined` so the fold falls back instead of throwing during replay.
 * @param meta - result metadata.
 * @returns validated hunks, or `undefined` for absent or malformed data.
 */
function diffsFromMeta(meta: unknown): FileChangeDiff[] | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const diffs = (meta as Record<string, unknown>).diffs
  if (!Array.isArray(diffs) || diffs.length === 0 || !diffs.every(isFileDiff)) return undefined
  return diffs
}

/** Truncate a present hunk side to the bound, marking the cut. */
function truncateText(text: string): string {
  if (text.length <= MAX_DIFF_CHARS) return text
  return `${text.slice(0, MAX_DIFF_CHARS)}\n…（已截断）`
}

/** Truncate one hunk side to the bound, marking the cut; null passes through. */
function truncateSide(text: string | null): string | null {
  return text === null ? null : truncateText(text)
}

/** The retained form of one change's hunks: bounded count and side length. */
function retainDiffs(diffs: FileChangeDiff[]): FileChangeDiff[] {
  return diffs.slice(0, MAX_DIFF_HUNKS).map(diff => ({
    path: diff.path,
    oldText: truncateSide(diff.oldText),
    newText: truncateText(diff.newText),
  }))
}

/** Parse a tool call's raw arguments for the file-mutation fields (model JSON boundary). */
function parseMutationArgs(name: string, argumentsRaw: string): { tool: 'edit' | 'write'; path: string; content?: string } | undefined {
  if (name !== 'edit' && name !== 'write') return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsRaw)
  } catch {
    /* v8 ignore next -- malformed model JSON carries no foldable fields; the result folds nothing */
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { file_path, content } = parsed as Record<string, unknown>
  if (typeof file_path !== 'string' || file_path.length === 0) return undefined
  return name === 'write' && typeof content === 'string' ? { tool: 'write', path: file_path, content } : { tool: 'edit', path: file_path }
}

/** The `fileChanges` unit registered on `ctx.sessionProjections` (exported for the unit spec). */
export const fileChangesProjectionDefinition: ProjectionDefinition<'fileChanges', FileChangesState> = {
  key: 'fileChanges',
  schema: fileChangesSchema,
  init: () => ({ files: {}, order: [], pending: {} }),
  apply: (state, event) => {
    // Every uninteresting event returns the same reference (Object.is gates the change feed).
    switch (event.type) {
      case 'tool/call': {
        const call = parseMutationArgs(event.data.name, event.data.arguments)
        if (call === undefined) return state
        return { ...state, pending: { ...state.pending, [event.data.callId]: call } }
      }
      case 'tool/result': {
        // Own-key check: callId is provider-minted (model/tool JSON boundary),
        // so a prototype property name on a result with no recorded call must
        // read as unmatched, not as an inherited value.
        const callId = event.data.message.source.callId
        if (!Object.hasOwn(state.pending, callId)) return state
        const pendingCall = state.pending[callId]
        /* v8 ignore next -- hasOwn above proves an own MutationCall value; inherited names are excluded */
        if (pendingCall === undefined) return state
        const pending = Object.fromEntries(Object.entries(state.pending).filter(([id]) => id !== callId))
        // An errored result changes nothing on disk: drop the park, keep the fold.
        if (event.data.message.content[0].isError === true) return { ...state, pending }
        const diffs = diffsFromMeta(event.data.meta)
          ?? (pendingCall.tool === 'write' && typeof pendingCall.content === 'string'
            ? [{ path: pendingCall.path, oldText: null, newText: pendingCall.content }]
            : undefined)
        let added = 0
        let removed = 0
        for (const diff of diffs ?? []) {
          const changed = changedLines(diff.oldText, diff.newText)
          added += changed.added
          removed += changed.removed
        }
        const path = pendingCall.path
        const previous = state.files[path]
        const entry: FileChangeStateEntry = {
          edits: (previous?.edits ?? 0) + 1,
          added: (previous?.added ?? 0) + added,
          removed: (previous?.removed ?? 0) + removed,
          lastAt: event.time,
          lastDiff: diffs === undefined ? null : retainDiffs(diffs),
        }
        // Touch order: move the path to the newest end, evicting the oldest
        // once past the bound.
        const order = [...state.order.filter(p => p !== path), path]
        const evictCount = Math.max(0, order.length - MAX_FILES)
        const evicted = new Set(order.slice(0, evictCount))
        const files = Object.fromEntries(Object.entries({ ...state.files, [path]: entry }).filter(([p]) => !evicted.has(p)))
        return { files, order: order.slice(evictCount), pending }
      }
      case 'turn/end':
        // A call whose result never landed belongs to a cancelled or failed
        // turn; results always land within their turn, so drop the leftovers
        // instead of growing persisted state forever.
        return Object.keys(state.pending).length === 0 ? state : { ...state, pending: {} }
      default:
        return state
    }
  },
  view: state => ({
    files: [...state.order].reverse().flatMap((path) => {
      const entry = state.files[path]
      /* v8 ignore next -- apply keeps order and files in sync (adds and evictions hit both), so every listed path has an entry */
      if (entry === undefined) return []
      return [{ path, edits: entry.edits, added: entry.added, removed: entry.removed, lastAt: entry.lastAt, lastDiff: entry.lastDiff }]
    }),
  }),
  stateVersion: 1,
}
