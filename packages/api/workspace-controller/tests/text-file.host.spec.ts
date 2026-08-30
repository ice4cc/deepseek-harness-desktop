/** Document-editor text-file verbs: direct host filesystem reads and guarded writes. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import WorkspaceController, { type Config } from '../src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

const roots: Context[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Compose the controller over real Session, Storage, Domain, and Workspace services. */
async function harness(config: Config = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-workspace-textfile-')))
  const ctx = new Context()
  roots.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  const dispose = (): void => {}
  ctx.provide('typert', {
    lookups: { configure: () => dispose },
    contexts: { configureHost: () => dispose },
  } as never)
  return { controller: new WorkspaceController(ctx, config), ctx, root }
}

function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path, { recursive: true })
  return path
}

const signal = (): AbortSignal => new AbortController().signal

describe('WorkspaceController readTextFile', () => {
  it('reads one regular file directly from the host filesystem', async () => {
    const { controller, root } = await harness()
    const content = '# 标题\nline two\n'
    const target = join(root, 'notes.txt')
    writeFileSync(target, content)
    // Multi-byte content: the decoded string and the byte size diverge. The
    // freshness token rides the read's own stat as an opaque non-empty string.
    const read = await controller.readTextFile({ path: target }, signal())
    expect(read).toMatchObject({ path: target, content, size: Buffer.byteLength(content) })
    expect(typeof read.version).toBe('string')
  })

  it('refuses non-fully-qualified paths instead of rebasing them under the process cwd', async () => {
    const { controller } = await harness()
    for (const relative of ['', 'notes.txt', './notes.txt', '..']) {
      await expect(controller.readTextFile({ path: relative }, signal()))
        .rejects.toMatchObject({ failure: { code: 'file-unreadable' } })
    }
  })

  it('fails file-unreadable for a missing target or a directory', async () => {
    const { controller, root } = await harness()
    const missing = join(root, 'no-such-file')
    await expect(controller.readTextFile({ path: missing }, signal()))
      .rejects.toMatchObject({ failure: { code: 'file-unreadable', details: { path: missing } } })
    const dir = stageDir(root, 'not-a-file')
    await expect(controller.readTextFile({ path: dir }, signal()))
      .rejects.toMatchObject({ failure: { code: 'file-unreadable' } })
  })

  it('bounds one payload at maxTextBytes: over fails file-too-large, exactly at the bound reads', async () => {
    const { controller, root } = await harness({ maxTextBytes: 10 })
    const target = join(root, 'sized.txt')
    writeFileSync(target, '0123456789') // exactly 10 bytes
    expect(await controller.readTextFile({ path: target }, signal()))
      .toMatchObject({ content: '0123456789' })
    writeFileSync(target, '0123456789X') // 11 bytes: one over the bound
    await expect(controller.readTextFile({ path: target }, signal()))
      .rejects.toMatchObject({ failure: { code: 'file-too-large', details: { path: target } } })
  })

  it('divides text from binary on a NUL within the leading 8 KiB', async () => {
    const { controller, root } = await harness()
    const nuly = join(root, 'nuly.bin')
    writeFileSync(nuly, Buffer.from([0x7f, 0x00, 0x41]))
    await expect(controller.readTextFile({ path: nuly }, signal()))
      .rejects.toMatchObject({ failure: { code: 'binary-file', details: { path: nuly } } })
    // A NUL just past the probe window does not make a file binary.
    const lateNul = join(root, 'late-nul.bin')
    writeFileSync(lateNul, Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0x00])]))
    expect(await controller.readTextFile({ path: lateNul }, signal()))
      .toMatchObject({ size: 8193 })
  })

  it('reports an aborted read as cancelled', async () => {
    const { controller, root } = await harness()
    writeFileSync(join(root, 'notes.txt'), 'text')
    const abort = new AbortController()
    abort.abort()
    await expect(controller.readTextFile({ path: join(root, 'notes.txt') }, abort.signal))
      .rejects.toMatchObject({ failure: { code: 'cancelled' } })
  })
})

describe('WorkspaceController writeTextFile', () => {
  it('writes one regular file and returns a fresh baseline the next read reflects', async () => {
    const { controller, root } = await harness()
    const target = join(root, 'notes.txt')
    writeFileSync(target, 'original\n')
    const before = await controller.readTextFile({ path: target }, signal())
    const written = await controller.writeTextFile(
      { path: target, content: 'edited content\n', expectedVersion: before.version },
      signal(),
    )
    expect(written).toMatchObject({ path: target, size: Buffer.byteLength('edited content\n') })
    expect(typeof written.version).toBe('string')
    // The save moved the baseline: a re-read sees the new bytes and a new token.
    const after = await controller.readTextFile({ path: target }, signal())
    expect(after.content).toBe('edited content\n')
    expect(after.version).not.toBe(before.version)
  })

  it('rejects a guarded save whose expectedVersion is stale, leaving the file untouched', async () => {
    const { controller, root } = await harness()
    const target = join(root, 'conflict.txt')
    writeFileSync(target, 'baseline-a\n')
    const baseline = await controller.readTextFile({ path: target }, signal())
    // An external writer moves the file (different size keeps the token distinct).
    writeFileSync(target, 'externally-changed-by-agent\n')
    await expect(controller.writeTextFile(
      { path: target, content: 'user-edit\n', expectedVersion: baseline.version },
      signal(),
    )).rejects.toMatchObject({ failure: { code: 'file-stale-version', details: { path: target } } })
    // The guarded save did not clobber the external change.
    expect(readFileSync(target, 'utf8')).toBe('externally-changed-by-agent\n')
  })

  it('fails a guarded save of a missing file as stale and an unguarded write to a directory as unwritable', async () => {
    const { controller, root } = await harness()
    const missing = join(root, 'no-such-file.txt')
    await expect(controller.writeTextFile(
      { path: missing, content: 'x', expectedVersion: 'fx-v1' },
      signal(),
    )).rejects.toMatchObject({ failure: { code: 'file-stale-version', details: { path: missing } } })

    const dir = stageDir(root, 'a-directory')
    await expect(controller.writeTextFile({ path: dir, content: 'x' }, signal()))
      .rejects.toMatchObject({ failure: { code: 'file-unwritable', details: { path: dir } } })
  })

  it('refuses non-fully-qualified paths with file-unwritable instead of rebasing them under the cwd', async () => {
    const { controller } = await harness()
    for (const relative of ['', 'notes.txt', './notes.txt', '..']) {
      await expect(controller.writeTextFile({ path: relative, content: 'x' }, signal()))
        .rejects.toMatchObject({ failure: { code: 'file-unwritable' } })
    }
  })

  it('bounds one payload at maxWriteBytes: over fails file-too-large, exactly at the bound writes', async () => {
    const { controller, root } = await harness({ maxWriteBytes: 10 })
    const target = join(root, 'sized.txt')
    writeFileSync(target, 'seed\n')
    const baseline = await controller.readTextFile({ path: target }, signal())
    // Exactly at the bound (10 bytes) writes.
    expect(await controller.writeTextFile(
      { path: target, content: '0123456789', expectedVersion: baseline.version },
      signal(),
    )).toMatchObject({ path: target })
    // One byte over the bound fails before any write.
    await expect(controller.writeTextFile({ path: target, content: '0123456789X' }, signal()))
      .rejects.toMatchObject({ failure: { code: 'file-too-large', details: { path: target } } })
  })

  it('reports an aborted write as cancelled', async () => {
    const { controller, root } = await harness()
    const target = join(root, 'notes.txt')
    writeFileSync(target, 'text\n')
    const abort = new AbortController()
    abort.abort()
    await expect(controller.writeTextFile({ path: target, content: 'x' }, abort.signal))
      .rejects.toMatchObject({ failure: { code: 'cancelled' } })
  })
})
