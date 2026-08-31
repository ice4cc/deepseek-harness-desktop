/**
 * The `fileChanges` projection unit: mounting the plugin beside the
 * projection registry serves a bounded per-path aggregation of successful
 * edit/write results; compositions without the registry are unaffected;
 * unmounting the plugin removes the key (HMR safety). Fold math runs against
 * the exported definition directly, where event times and payloads are
 * controlled.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as FileChangesPlugin from '@deepseek-ai/dsh-file-changes'
import { fileChangesProjectionDefinition, MAX_DIFF_CHARS, MAX_DIFF_HUNKS, MAX_FILES } from '@deepseek-ai/dsh-file-changes/src/projection.ts'
import type { FileChangeDiff } from '@deepseek-ai/dsh-file-changes/types'

async function harness(withPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  if (withPlugin) await ctx.plugin(FileChangesPlugin)
  return { ctx, session: ctx.sessions.create(SessionId('file-changes')) }
}

/** Append one tool/call with raw JSON arguments; returns the appended event. */
function appendCall(session: Session, callId: string, name: string, args: unknown): SessionEvent {
  return session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: JSON.stringify(args) })
}

/** Append the paired tool/result with an optional error flag and meta; returns the appended event. */
function appendResult(session: Session, callId: string, isError = false, meta?: unknown): SessionEvent {
  return session.append('tool/result', {
    turn: 1, step: 1,
    message: createToolResultMessage({
      callId: ToolCallId(callId),
      content: [{ type: 'text', text: isError ? 'Error: failed' : 'ok' }],
      isError,
    }),
    // Test-constructed JSON at the log boundary; the fold narrows it defensively.
    ...(meta !== undefined ? { meta: meta as JsonValue } : {}),
  }, { surfaceOp: 'append' })
}

/** One successful edit fold through the registry; returns the result event. */
function appendEdit(session: Session, callId: string, path: string, diffs: FileChangeDiff[]): SessionEvent {
  appendCall(session, callId, 'edit', { file_path: path, old_string: 'a', new_string: 'b' })
  return appendResult(session, callId, false, { diffs })
}

describe('fileChanges projection unit (registry drive)', () => {
  it('serves an empty aggregation on the empty log', async () => {
    const { ctx, session } = await harness(true)
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toEqual({ files: [] })
  })

  it('folds one successful edit with meta hunks into counts and the retained diff', async () => {
    const { ctx, session } = await harness(true)
    const result = appendEdit(session, 'e1', '/w/a.ts', [{ path: '/w/a.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }])
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toEqual({
      files: [{
        path: '/w/a.ts', edits: 1, added: 1, removed: 1,
        lastAt: result.time,
        lastDiff: [{ path: '/w/a.ts', oldText: 'a\nb\nc', newText: 'a\nB\nc' }],
      }],
    })
  })

  it('folds a create write without meta through the args fallback', async () => {
    const { ctx, session } = await harness(true)
    appendCall(session, 'w1', 'write', { file_path: '/w/new.md', content: 'x\ny\n' })
    const result = appendResult(session, 'w1')
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toEqual({
      files: [{
        path: '/w/new.md', edits: 1, added: 2, removed: 0,
        lastAt: result.time,
        lastDiff: [{ path: '/w/new.md', oldText: null, newText: 'x\ny\n' }],
      }],
    })
  })

  it('prefers meta hunks over the args fallback on an overwrite write', async () => {
    const { ctx, session } = await harness(true)
    appendCall(session, 'w2', 'write', { file_path: '/w/old.ts', content: 'full new body' })
    appendResult(session, 'w2', false, { diffs: [{ path: '/w/old.ts', oldText: 'one line', newText: 'full new body' }] })
    const value = ctx.sessionProjections.snapshot(session).values.fileChanges!
    expect(value.files[0]?.lastDiff).toEqual([{ path: '/w/old.ts', oldText: 'one line', newText: 'full new body' }])
  })

  it('ignores errored results, non-mutation tools, malformed arguments, and unpaired results', async () => {
    const { ctx, session } = await harness(true)
    appendCall(session, 'e-err', 'edit', { file_path: '/w/err.ts', old_string: 'a', new_string: 'b' })
    appendResult(session, 'e-err', true)
    appendCall(session, 'bash-1', 'bash', { command: 'echo hi' })
    appendResult(session, 'bash-1')
    session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('bad-json'), name: 'edit', arguments: '{not json' })
    appendCall(session, 'no-path', 'write', { content: 'x' })
    appendResult(session, 'ghost')
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toEqual({ files: [] })
    // The errored call's pending slot is gone: a later success on the same
    // path folds fresh instead of double-counting.
    appendEdit(session, 'e-err-2', '/w/err.ts', [{ path: '/w/err.ts', oldText: null, newText: 'fresh' }])
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges!.files[0]).toMatchObject({
      path: '/w/err.ts', edits: 1, added: 1, removed: 0,
    })
  })

  it('accumulates repeated edits on one path and keeps only the newest diff', async () => {
    const { ctx, session } = await harness(true)
    appendEdit(session, 'a1', '/w/a.ts', [{ path: '/w/a.ts', oldText: 'v0', newText: 'v1' }])
    appendEdit(session, 'a2', '/w/a.ts', [{ path: '/w/a.ts', oldText: 'v1\nctx', newText: 'v2\nctx' }])
    const value = ctx.sessionProjections.snapshot(session).values.fileChanges!
    expect(value.files).toHaveLength(1)
    expect(value.files[0]).toMatchObject({ path: '/w/a.ts', edits: 2, added: 2, removed: 2 })
    expect(value.files[0]?.lastDiff).toEqual([{ path: '/w/a.ts', oldText: 'v1\nctx', newText: 'v2\nctx' }])
  })

  it('orders paths newest-touched first and evicts the oldest past the bound', async () => {
    const { ctx, session } = await harness(true)
    for (let i = 0; i < MAX_FILES; i++) {
      appendEdit(session, `f${i}`, `/w/f${i}.ts`, [{ path: `/w/f${i}.ts`, oldText: null, newText: 'x' }])
    }
    // Re-touch the first path: it moves to the newest end and survives the
    // eviction that the next new path triggers.
    appendEdit(session, 're', '/w/f0.ts', [{ path: '/w/f0.ts', oldText: 'x', newText: 'y' }])
    appendEdit(session, 'f32', `/w/f${MAX_FILES}.ts`, [{ path: `/w/f${MAX_FILES}.ts`, oldText: null, newText: 'x' }])
    const value = ctx.sessionProjections.snapshot(session).values.fileChanges!
    expect(value.files).toHaveLength(MAX_FILES)
    expect(value.files[0]?.path).toBe(`/w/f${MAX_FILES}.ts`)
    expect(value.files.map(entry => entry.path)).not.toContain('/w/f1.ts')
    expect(value.files.map(entry => entry.path)).toContain('/w/f0.ts')
  })

  it('truncates hunk sides and bounds the retained hunk count', async () => {
    const { ctx, session } = await harness(true)
    const longSide = 'l'.repeat(MAX_DIFF_CHARS + 100)
    const hunks: FileChangeDiff[] = Array.from({ length: MAX_DIFF_HUNKS + 5 }, (_, i) => ({
      path: '/w/big.ts', oldText: `old-${i}`, newText: longSide,
    }))
    appendEdit(session, 'big', '/w/big.ts', hunks)
    const entry = ctx.sessionProjections.snapshot(session).values.fileChanges!.files[0]!
    expect(entry.lastDiff).toHaveLength(MAX_DIFF_HUNKS)
    for (const diff of entry.lastDiff!) {
      expect(diff.newText.length).toBeLessThanOrEqual(MAX_DIFF_CHARS + '…（已截断）'.length + 1)
      expect(diff.newText.endsWith('…（已截断）')).toBe(true)
    }
    // Truncation is display-side only: the counts still cover every hunk.
    expect(entry.added).toBe(MAX_DIFF_HUNKS + 5)
    expect(entry.removed).toBe(MAX_DIFF_HUNKS + 5)
  })

  it('drops parked calls whose result never lands when the turn ends', async () => {
    const { ctx, session } = await harness(true)
    appendCall(session, 'lost', 'edit', { file_path: '/w/lost.ts', old_string: 'a', new_string: 'b' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // A late result for the pruned call must not fold.
    appendResult(session, 'lost')
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toEqual({ files: [] })
  })

  it('notifies the change feed on state changes with the causing seq', async () => {
    const { ctx, session } = await harness(true)
    const changes: { key: string; seq: number }[] = []
    ctx.sessionProjections.onChanged((_s, key, _value, seq) => { changes.push({ key, seq }) })
    const call = appendCall(session, 'n1', 'edit', { file_path: '/w/n.ts', old_string: 'a', new_string: 'b' })
    // The feed fires on every state change (session-stats parity): parking the
    // call at tool/call and folding it at tool/result are two transitions.
    appendResult(session, 'n1', false, { diffs: [{ path: '/w/n.ts', oldText: null, newText: 'x' }] })
    expect(changes).toEqual([
      { key: 'fileChanges', seq: call.seq },
      { key: 'fileChanges', seq: call.seq + 1 },
    ])
  })

  it('removes the key when the plugin unmounts (HMR safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const fiber = await ctx.plugin(FileChangesPlugin)
    const session = ctx.sessions.create(SessionId('file-changes-hmr'))
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toBeDefined()
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values.fileChanges).toBeUndefined()
  })

  it('leaves compositions without the plugin untouched', async () => {
    const { ctx, session } = await harness(false)
    expect(ctx.sessionProjections.snapshot(session).values).toEqual({})
  })
})

/** One raw tool/call event for direct definition driving. */
function callEvent(callId: string, name: string, args: unknown, time = 1000): SessionEvent {
  return { type: 'tool/call', seq: 1, time, data: { turn: 1, step: 1, callId: ToolCallId(callId), name, arguments: JSON.stringify(args) } }
}

/** One raw tool/result event for direct definition driving. */
function resultEvent(callId: string, meta?: unknown, isError = false, time = 2000): SessionEvent {
  return {
    type: 'tool/result', seq: 2, time,
    data: {
      turn: 1, step: 1,
      message: createToolResultMessage({ callId: ToolCallId(callId), content: [{ type: 'text', text: 'ok' }], isError }),
      ...(meta !== undefined ? { meta } : {}),
    },
  } as SessionEvent
}

describe('fileChanges fold math (direct definition drive)', () => {
  it('counts changed lines as the context-cancelled multiset difference', () => {
    let state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('m1', 'edit', { file_path: '/w/m.ts', old_string: 'a', new_string: 'b' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m1', {
      diffs: [{ path: '/w/m.ts', oldText: 'x\nx\ny', newText: 'x\nz' }],
    }))
    const entry = fileChangesProjectionDefinition.wire.view(state).files[0]!
    // Old multiset {x:2, y:1} vs new {x:1, z:1}: one x cancels, so added=1 (z), removed=2 (x, y).
    expect(entry).toMatchObject({ added: 1, removed: 2 })
  })

  it('treats a trailing newline as a terminator, not an extra line', () => {
    let state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('m2', 'edit', { file_path: '/w/t.ts', old_string: 'a', new_string: 'b' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m2', {
      diffs: [{ path: '/w/t.ts', oldText: 'a\n', newText: 'a' }],
    }))
    expect(fileChangesProjectionDefinition.wire.view(state).files[0]).toMatchObject({ added: 0, removed: 0 })
  })

  it('records the event time as lastAt and keeps the same reference for foreign events', () => {
    let state = fileChangesProjectionDefinition.init()
    const foreign = callEvent('m3', 'read', { file_path: '/w/r.ts' })
    expect(fileChangesProjectionDefinition.apply(state, foreign)).toBe(state)
    state = fileChangesProjectionDefinition.apply(state, callEvent('m4', 'edit', { file_path: '/w/t.ts', old_string: 'a', new_string: 'b' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m4', { diffs: [{ path: '/w/t.ts', oldText: null, newText: 'x' }] }, false, 4242))
    expect(fileChangesProjectionDefinition.wire.view(state).files[0]?.lastAt).toBe(4242)
  })

  it('reads a prototype property name on an unpaired result as unmatched', () => {
    const state = fileChangesProjectionDefinition.init()
    const next = fileChangesProjectionDefinition.apply(state, resultEvent('constructor'))
    expect(next).toBe(state)
  })

  it('folds a successful edit without meta as counts-only with a null diff', () => {
    let state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('m5', 'edit', { file_path: '/w/e.ts', old_string: 'a', new_string: 'b' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m5'))
    expect(fileChangesProjectionDefinition.wire.view(state).files[0]).toMatchObject({ edits: 1, added: 0, removed: 0, lastDiff: null })
  })

  it('counts an emptied file as all lines removed', () => {
    let state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('m6', 'write', { file_path: '/w/empty.ts', content: 'a\n' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m6', { diffs: [{ path: '/w/empty.ts', oldText: 'a\n', newText: '' }] }))
    expect(fileChangesProjectionDefinition.wire.view(state).files[0]).toMatchObject({ added: 0, removed: 1 })
  })

  it('falls back when meta carries an empty or malformed diff list', () => {
    // Empty list: the write args fallback supplies the diff.
    let state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('m7', 'write', { file_path: '/w/w.ts', content: 'x\n' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m7', { diffs: [] }))
    expect(fileChangesProjectionDefinition.wire.view(state).files[0]?.lastDiff).toEqual([{ path: '/w/w.ts', oldText: null, newText: 'x\n' }])
    // Malformed entry: same fallback.
    state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('m8', 'write', { file_path: '/w/w2.ts', content: 'y\n' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('m8', { diffs: [{ path: '/w/w2.ts', oldText: null, newText: 'y\n' }, 'junk'] }))
    expect(fileChangesProjectionDefinition.wire.view(state).files[0]?.lastDiff).toEqual([{ path: '/w/w2.ts', oldText: null, newText: 'y\n' }])
  })

  it('parks nothing for arguments that parse to a non-object', () => {
    const state = fileChangesProjectionDefinition.init()
    const next = fileChangesProjectionDefinition.apply(state, { type: 'tool/call', seq: 1, time: 1000, data: { turn: 1, step: 1, callId: ToolCallId('m9'), name: 'write', arguments: '42' } })
    expect(next).toBe(state)
  })

  it('validates the wire payload through the unit schema', () => {
    let state = fileChangesProjectionDefinition.init()
    state = fileChangesProjectionDefinition.apply(state, callEvent('s1', 'write', { file_path: '/w/s.md', content: 'a\n' }))
    state = fileChangesProjectionDefinition.apply(state, resultEvent('s1'))
    const value = fileChangesProjectionDefinition.wire.view(state)
    expect(fileChangesProjectionDefinition.wire.viewSchema.parse(value)).toEqual(value)
  })
})
