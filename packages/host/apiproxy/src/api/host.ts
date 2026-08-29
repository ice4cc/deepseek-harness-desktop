/**
 * host domain contract. No protocol version: client and host ship
 * together; introduce protocolVersion only when an independently released client appears.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** One directory row of a listing: a child entry or a breadcrumb ancestor. */
export interface DirectoryEntry {
  /** Base name shown in a browser row (a root crumb carries its full path). */
  name: string
  /** Absolute host path — the client never joins path segments itself. */
  path: string
  /** Hidden by the host platform's convention (dot-prefixed on POSIX); the client owns whether to show it. */
  hidden: boolean
}

/** host.listDirectory response value: one directory level plus its ancestry. */
export interface DirectoryListing {
  /** Absolute path of the listed directory. */
  path: string
  /** The host account's home directory (breadcrumb "Home" rooting). */
  home: string
  /**
   * Ancestor chain from the filesystem root to the listed directory
   * inclusive; every crumb is a jump target (crumb `hidden` is always false).
   */
  crumbs: DirectoryEntry[]
  /** Direct child directories, name-sorted; symlinks to directories included. */
  entries: DirectoryEntry[]
  /** True when the backend cut `entries` at its complete-result bound (the name-sorted tail is absent). */
  truncated: boolean
}

/** host.readTextFile response value: one text file's decoded content. */
export interface TextFileContent {
  /** Absolute path of the read file (echoes the resolved target). */
  path: string
  /** UTF-8 decoded content. */
  content: string
  /** On-disk size in bytes. */
  size: number
  /**
   * Freshness token for conflict detection (opaque to the client): echo it back
   * as `writeTextFile`'s expectedVersion so a save is rejected when the file has
   * changed on disk since this read.
   */
  version: string
}

/** host.writeTextFile response value: the written file's fresh baseline. */
export interface WrittenTextFile {
  /** Absolute path of the written file (echoes the resolved target). */
  path: string
  /** Freshness token of the newly written content — the next expectedVersion baseline. */
  version: string
  /** On-disk size in bytes after the write. */
  size: number
}

/** Host-level unary methods. */
export interface HostApi {
  /**
   * One-shot host snapshot. Empty payload uses the literal `{}` (extend in place when fields arrive).
   * version = the host app's (apps/cli) package.json version; cwd = the host process working
   * directory (root for session persistence and tool execution); provider/model = the defaults
   * applied when a new agent doesn't specify them explicitly, absent when the host configures
   * no explicit default (the adapter falls back internally);
   * attachedSessions = count of currently attached sessions (those with a live agent);
   * home = the host account home directory (Web display abbreviation on POSIX);
   * canOpenPath = whether this deployment can hand a path to a user-visible native desktop.
   */
  describe(request: RpcRequest<{}>): Promise<RpcResponse<{
    version: string
    cwd: string
    provider?: string
    model?: string
    attachedSessions: number
    home: string
    canOpenPath: boolean
  }>>

  /**
   * Open the operating system's single-directory picker; cancellation returns
   * null. Only served under the `native` capability.
   */
  pickDirectory(
    request: RpcRequest<{}>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ path: string | null }>>

  /**
   * List one directory level for the in-app browser; an absent path lists the
   * host account's home directory. Only served under the `browse` capability;
   * unreadable or missing targets fail with `directory-unreadable`. The
   * carrier's request signal follows the caller, stopping the backend's scan
   * on disconnect or timeout.
   */
  listDirectory(
    request: RpcRequest<{ path?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<DirectoryListing>>

  /**
   * Create one child directory under an existing parent (the browser's
   * "New folder"). Only served under the `browse` capability; an existing
   * child fails with `directory-exists`, every other filesystem failure with
   * `directory-create-failed`.
   */
  createDirectory(
    request: RpcRequest<{ path: string; name: string }>,
  ): Promise<RpcResponse<{ path: string }>>

  /**
   * Read one regular file as UTF-8 text (the in-app document viewer's read),
   * served directly from the host filesystem under every composed picker kind.
   * A path that is not fully qualified, a missing or non-regular target, or
   * any other filesystem failure fails with `file-unreadable`; an oversized
   * file (over the gateway's text bound) with `file-too-large`, a non-text
   * file with `binary-file`. The carrier's request signal follows the caller,
   * stopping the read on disconnect or timeout.
   */
  readTextFile(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<TextFileContent>>

  /**
   * Write one text file's full content (the in-app document editor's save),
   * served directly to the host filesystem under every composed picker kind,
   * like readTextFile. A path that is not fully qualified, a directory target,
   * or any other filesystem failure fails with `file-unwritable`; an oversized
   * payload (over the gateway's write bound) with `file-too-large`. When
   * expectedVersion is supplied and does not match the current on-disk token —
   * or names a file that no longer exists — the guard fails with
   * `file-stale-version` instead of clobbering; omitting it overwrites
   * unconditionally (the conflict banner's "overwrite anyway" path). The carrier's
   * request signal follows the caller, stopping the write on disconnect or timeout.
   */
  writeTextFile(
    request: RpcRequest<{ path: string; content: string; expectedVersion?: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<WrittenTextFile>>

  /**
   * Open a filesystem path with the operating system's default application
   * (Finder / Explorer / xdg-open hand-off). The browser carrier's
   * prefix-wide trust fence covers this privileged method like every other
   * `/api` request.
   */
  openPath(
    request: RpcRequest<{ path: string }>,
    signal: AbortSignal,
  ): Promise<RpcResponse<{ opened: true }>>
}
