/** Host Workspace Remote owner: explicit commands and reconnect-safe state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { DEFAULT_MAX_TEXT_BYTES, DEFAULT_MAX_WRITE_BYTES, WorkspaceCommands } from './commands.ts'
import { DirectoryPickerController } from './directory-picker.ts'
import { WorkspaceFeed } from './feed.ts'
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
  WorkspaceFollowFrame,
  WorkspaceInsertBeforeRequest,
  WorkspaceInsertSessionBeforeRequest,
  WorkspaceOrderValue,
  WorkspaceRenameRequest,
  WorkspaceValue,
} from './types.ts'

export type * from './types.ts'
export { DirectoryPickerController } from './directory-picker.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Workspace business API and Remote namespace owner. */
    workspaceController: WorkspaceController
  }
}

/** Document-editor text-file payload policy. */
export interface Config {
  /** On-disk size bound of one `readTextFile` payload in bytes. @default 1_000_000 */
  readonly maxTextBytes?: number
  /** Byte bound of one `writeTextFile` payload. @default 1_000_000 */
  readonly maxWriteBytes?: number
}

/** Host service backing the generated `ctx.remote.workspace` namespace. */
export class WorkspaceController extends TypertRemoteService {
  static inject = ['typert', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    maxTextBytes: z.natural().min(1).default(DEFAULT_MAX_TEXT_BYTES),
    maxWriteBytes: z.natural().min(1).default(DEFAULT_MAX_WRITE_BYTES),
  })

  private readonly commands: WorkspaceCommands
  private readonly feed: WorkspaceFeed

  /** @param ctx - Host context containing the Workspace registry. */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'workspaceController', { namespace: 'workspace' })
    this.commands = new WorkspaceCommands(ctx, {
      maxTextBytes: config.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES,
      maxWriteBytes: config.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES,
    })
    this.feed = new WorkspaceFeed(ctx)
    // This package is the Loader entry for both Remote owners it hosts: the
    // directory-picking seam is abstract and never an entry itself. The child
    // stays pending until a picking backend is composed, so a host without one
    // registers no picking namespace instead of answering an unservable verb.
    ctx.plugin(DirectoryPickerController)
  }

  /**
   * Create or idempotently resolve one Workspace over an existing directory.
   * @param request - directory path to register.
   * @returns the Workspace and whether this call created it.
   */
  @Remote('create')
  create(request: WorkspaceCreateRequest): Promise<WorkspaceCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Rename one Workspace to a unique non-blank title.
   * @param request - Workspace identity and proposed title.
   * @returns the updated Workspace projection.
   */
  @Remote('rename')
  rename(request: WorkspaceRenameRequest): Promise<WorkspaceValue> {
    return this.commands.rename(request)
  }

  /**
   * Remove one Workspace registration while retaining files and Sessions.
   * @param request - Workspace identity to remove.
   * @returns deletion confirmation.
   */
  @Remote('delete')
  delete(request: WorkspaceDeleteRequest): Promise<WorkspaceDeleteValue> {
    return this.commands.delete(request)
  }

  /**
   * Move one Workspace within the registry display order.
   * @param request - moved Workspace and optional anchor.
   * @returns the complete resulting Workspace order.
   */
  @Remote('insertBefore')
  insertBefore(request: WorkspaceInsertBeforeRequest): Promise<WorkspaceOrderValue> {
    return this.commands.insertBefore(request)
  }

  /**
   * Move one accounted Session within a Workspace.
   * @param request - Workspace, Session, and optional anchor identities.
   * @returns the updated Workspace projection.
   */
  @Remote('insertSessionBefore')
  insertSessionBefore(request: WorkspaceInsertSessionBeforeRequest): Promise<WorkspaceValue> {
    return this.commands.insertSessionBefore(request)
  }

  /**
   * Hide one known Session from Workspace grouping surfaces.
   * @param request - Session identity to archive.
   * @returns the complete resulting archive set.
   */
  @Remote('archiveSession')
  archiveSession(request: WorkspaceArchiveSessionRequest): Promise<WorkspaceArchiveValue> {
    return this.commands.archiveSession(request)
  }

  /**
   * Read one text file for the in-app document editor, serving the host
   * filesystem directly under every composed picking kind.
   * @param request - fully qualified file path to read.
   * @param signal - caller lifetime; abort stops the read instead of outliving it.
   * @returns the decoded content with its size and freshness token.
   */
  @Remote('readTextFile')
  readTextFile(request: TextFileReadRequest, signal: AbortSignal): Promise<TextFileReadValue> {
    return this.commands.readTextFile(request, signal)
  }

  /**
   * Write one text file's full content (the document editor's save), guarded by
   * an optional freshness token so a stale save never clobbers a moved file.
   * @param request - fully qualified target, full content, and optional guard.
   * @param signal - caller lifetime; abort stops the write instead of outliving it.
   * @returns the written file's fresh baseline.
   */
  @Remote('writeTextFile')
  writeTextFile(request: TextFileWriteRequest, signal: AbortSignal): Promise<TextFileWriteValue> {
    return this.commands.writeTextFile(request, signal)
  }

  /**
   * Stream a complete Workspace baseline followed by ordered increments.
   * @param signal - generation cancellation.
   * @returns baseline followed by ordered Workspace increments.
   */
  @Remote({ mode: 'stream' })
  follow(signal: AbortSignal): AsyncIterable<WorkspaceFollowFrame> {
    return this.feed.follow(signal)
  }
}

export default WorkspaceController
