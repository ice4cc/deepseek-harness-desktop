/** Workspace command implementation and stable Remote failure mapping. */

import type { Stats } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { posix, resolve, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import {
  WorkspaceId,
  WorkspaceMoveInvalidError,
  WorkspaceOrderInvalidError,
  WorkspaceUnknownSessionError,
} from '@deepseek-ai/dsh-workspace'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { workspaceView } from './feed.ts'
import type {
  TextFileReadRequest,
  TextFileReadValue,
  TextFileWriteRequest,
  TextFileWriteValue,
  WorkspaceArchiveSessionRequest,
  WorkspaceArchiveValue,
  WorkspaceCreateRequest,
  WorkspaceCreateValue,
  WorkspaceDeleteRequest,
  WorkspaceDeleteValue,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

/** Default on-disk size bound of one `readTextFile` payload in bytes. */
export const DEFAULT_MAX_TEXT_BYTES = 1_000_000

/** Default byte bound of one `writeTextFile` payload (symmetric with the read text bound). */
export const DEFAULT_MAX_WRITE_BYTES = 1_000_000

/** Resolved document-editor payload bounds. */
export interface WorkspaceCommandsConfig {
  readonly maxTextBytes: number
  readonly maxWriteBytes: number
}

/** Implements Workspace mutations against the authoritative registry and the document editor's text-file verbs. */
export class WorkspaceCommands {
  private operationTail = Promise.resolve()

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(
    private readonly ctx: Context,
    private readonly config: WorkspaceCommandsConfig = {
      maxTextBytes: DEFAULT_MAX_TEXT_BYTES,
      maxWriteBytes: DEFAULT_MAX_WRITE_BYTES,
    },
  ) {}

  /**
   * Create or resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.enqueue(async () => {
      try {
        const existing = await this.ctx.workspaceRegistry.resolveByPath(request.path)
        if (existing !== undefined) {
          return { workspace: workspaceView(existing), created: false }
        }
        const workspace = await this.ctx.workspaceRegistry.create(request.path)
        return { workspace: workspaceView(workspace), created: true }
      } catch (error) {
        if (remoteErrorOf(error) !== undefined) throw error
        throw new RemoteError(
          'workspace/invalid-path',
          `cannot create a Workspace at "${request.path}": ${errorMessage(error)}`,
          { path: request.path },
          { cause: error },
        )
      }
    })
  }

  /**
   * Rename one Workspace after serializing title ownership checks.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    const title = request.title.trim()
    if (title === '') {
      return Promise.reject(new RemoteError('gateway/bad-request', 'Workspace rename requires a non-blank title', {}))
    }
    return this.enqueue(async () => {
      const workspace = this.requireWorkspace(request.workspaceId)
      if (title !== workspace.title) {
        if (this.ctx.workspaceRegistry.list().some(candidate =>
          candidate.id !== workspace.id && candidate.title === title)) {
          throw new RemoteError(
            'workspace/name-conflict',
            `Workspace name '${title}' is already in use`,
            { name: title },
          )
        }
        await workspace.setTitle(title)
      }
      return { workspace: workspaceView(workspace) }
    })
  }

  /**
   * Delete one Workspace registration without deleting its directory or Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.enqueue(async () => {
      if (!await this.ctx.workspaceRegistry.delete(WorkspaceId(request.workspaceId))) {
        throw workspaceNotFound(request.workspaceId)
      }
      return { deleted: true }
    })
  }

  /**
   * Move one Workspace within the durable registry order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  async insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    try {
      const workspaceIds = await this.ctx.workspaceRegistry.insertBefore(
        WorkspaceId(request.workspaceId),
        request.beforeWorkspaceId === undefined
          ? undefined
          : WorkspaceId(request.beforeWorkspaceId),
      )
      return { workspaceIds: [...workspaceIds] }
    } catch (error) {
      if (!(error instanceof WorkspaceOrderInvalidError)) throw error
      throw workspaceNotFound(error.workspaceId)
    }
  }

  /**
   * Move one accounted Session within a Workspace's manual order.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  async insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    const workspace = this.requireWorkspace(request.workspaceId)
    try {
      await workspace.insertSessionBefore(request.sessionId, request.beforeSessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceMoveInvalidError)) throw error
      throw new RemoteError(
        'workspace/move-invalid',
        error.message,
        {
          workspaceId: request.workspaceId,
          sessionId: request.sessionId,
          ...request.beforeSessionId === undefined
            ? {}
            : { beforeSessionId: request.beforeSessionId },
        },
        { cause: error },
      )
    }
    return { workspace: workspaceView(workspace) }
  }

  /**
   * Add one known Session to the registry-global archive set.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  async archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    try {
      await this.ctx.workspaceRegistry.archiveSession(request.sessionId)
    } catch (error) {
      if (!(error instanceof WorkspaceUnknownSessionError)) throw error
      throw new RemoteError('session/not-found', error.message, { sessionId: request.sessionId }, { cause: error })
    }
    return { archivedSessionIds: [...this.ctx.workspaceRegistry.archivedSessionIds] }
  }

  /**
   * Read one text file for the in-app document editor. Serves the host
   * filesystem directly: the read is not a picker interaction, so it must work
   * under every composed picking kind (a native desktop opens its own changed
   * files). An oversized or binary target never reaches the wire; the stat's
   * identity stamps the freshness baseline for the guarded save.
   * @param request - fully qualified file path to read.
   * @param signal - caller lifetime; abort stops the read instead of outliving it.
   * @returns the decoded content with its size and freshness token.
   */
  async readTextFile(request: TextFileReadRequest, signal: AbortSignal): Promise<TextFileReadValue> {
    const path = request.path
    if (!fullyQualified(path)) {
      throw new RemoteError('file/unreadable', `cannot read "${path}": not a fully qualified path`, { path })
    }
    const target = resolve(path)
    let info: Stats
    try {
      info = await raceAbort(stat(target), signal)
    } catch (error) {
      throw textFileReadFailure(error, signal, target)
    }
    if (!info.isFile()) {
      throw new RemoteError('file/unreadable', `${target} is not a regular file`, { path: target })
    }
    // The stat fact bounds the payload before any byte is read.
    if (info.size > this.config.maxTextBytes) {
      throw new RemoteError(
        'file/too-large',
        `${target} is ${info.size} bytes; the text bound is ${this.config.maxTextBytes}`,
        { path: target },
      )
    }
    let buffer: Buffer
    try {
      buffer = await raceAbort(readFile(target), signal)
    } catch (error) {
      throw textFileReadFailure(error, signal, target)
    }
    // Text/binary divider: a NUL anywhere in the leading 8 KiB. Documents and
    // source never carry NUL; real binaries almost always do within the head.
    if (buffer.subarray(0, 8192).includes(0)) {
      throw new RemoteError('file/binary', `${target} is not a text file`, { path: target })
    }
    return { path: target, content: buffer.toString('utf8'), size: info.size, version: versionToken(info) }
  }

  /**
   * Write one text file's full content (the document editor's save). The payload
   * bound is checked before any byte is written, and a supplied expectedVersion
   * guards against clobbering a file that moved on disk since the tab's baseline
   * read; omitting it overwrites unconditionally.
   * @param request - fully qualified target, full content, and optional freshness guard.
   * @param signal - caller lifetime; abort stops the write instead of outliving it.
   * @returns the written file's fresh baseline.
   */
  async writeTextFile(request: TextFileWriteRequest, signal: AbortSignal): Promise<TextFileWriteValue> {
    const path = request.path
    if (!fullyQualified(path)) {
      throw new RemoteError('file/unwritable', `cannot write "${path}": not a fully qualified path`, { path })
    }
    const target = resolve(path)
    const content = request.content
    const byteLength = Buffer.byteLength(content, 'utf8')
    if (byteLength > this.config.maxWriteBytes) {
      throw new RemoteError(
        'file/too-large',
        `${target} would be ${byteLength} bytes; the write bound is ${this.config.maxWriteBytes}`,
        { path: target },
      )
    }
    const expectedVersion = request.expectedVersion
    // The stat both supplies the freshness baseline and proves the target is a
    // regular file; the guard compares against it before any write. A missing
    // target throws here — a guarded save of a vanished file reports stale (the
    // safe direction), an unguarded one is simply unwritable.
    let info: Stats
    try {
      info = await raceAbort(stat(target), signal)
    } catch (error) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'file write was aborted', {})
      if (expectedVersion !== undefined) {
        throw new RemoteError('file/stale-version', `${target} changed since it was read`, { path: target })
      }
      throw new RemoteError('file/unwritable', `cannot write ${target}: ${errorMessage(error)}`, { path: target })
    }
    if (!info.isFile()) {
      // A directory (or other non-regular target): guarded reads stale, unguarded unwritable.
      if (expectedVersion !== undefined) {
        throw new RemoteError('file/stale-version', `${target} changed since it was read`, { path: target })
      }
      throw new RemoteError('file/unwritable', `${target} is not a regular file`, { path: target })
    }
    if (expectedVersion !== undefined && versionToken(info) !== expectedVersion) {
      throw new RemoteError('file/stale-version', `${target} changed since it was read`, { path: target })
    }
    let after: Stats
    try {
      await raceAbort(writeFile(target, content, 'utf8'), signal)
      after = await stat(target)
    } catch (error) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'file write was aborted', {})
      throw new RemoteError('file/unwritable', `cannot write ${target}: ${errorMessage(error)}`, { path: target })
    }
    return { path: target, version: versionToken(after), size: after.size }
  }

  private requireWorkspace(workspaceId: WorkspaceId): Workspace {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw workspaceNotFound(workspaceId)
    return workspace
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => undefined, () => undefined)
    return result
  }
}

function workspaceNotFound(workspaceId: WorkspaceId): RemoteError<'workspace/not-found'> {
  return new RemoteError(
    'workspace/not-found',
    `Workspace "${workspaceId}" not found`,
    { workspaceId },
  )
}

/** Classify a text-file read rejection; an abort is the caller's own outcome. */
function textFileReadFailure(error: unknown, signal: AbortSignal, target: string): RemoteError {
  if (signal.aborted) return new RemoteError('gateway/cancelled', 'file read was aborted', {})
  return new RemoteError('file/unreadable', `cannot read ${target}: ${errorMessage(error)}`, { path: target })
}

/**
 * Derive the document-editor freshness token from a stat: device, inode, size,
 * and the mtime/ctime stamps. It is opaque to the client (an echo-back guard)
 * and changes whenever the file's content-relevant identity or timestamps move,
 * so a guarded write that lands on a changed file reports stale. The same
 * derivation runs on the read and write paths, keeping the two comparable.
 */
function versionToken(info: Stats): string {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
}

/**
 * True when the path names one fixed filesystem location regardless of
 * process state: POSIX-absolute on POSIX; on Windows only drive-qualified
 * (`C:\…`) or complete UNC (`\\server\share…`) forms. Rooted drive-less
 * forms (`\foo`, `/foo`) and incomplete UNC prefixes (`\\`, `\\server`)
 * pass `isAbsolute` yet still resolve against the process's current drive.
 * @param path - candidate path.
 * @param platform - replaces `process.platform` for deterministic tests.
 * @returns whether the path is fully qualified on the platform.
 */
function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/** The thrown value as an Error (wire/abort reasons may be anything). */
function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation
 * itself keeps running against a handle the caller then closes — its late
 * settlement is swallowed here so an abandoned read cannot surface as an
 * unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime.
 * @returns the operation's value.
 */
function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller,
        // and the abort reason already carried the outcome.
      })
      rejectPromise(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolvePromise(value) },
      (error) => { signal.removeEventListener('abort', onAbort); rejectPromise(error) },
    )
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
