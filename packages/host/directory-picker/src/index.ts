/**
 * Service Definition for the `ctx.directoryPicker` capability seam: how the web-GUI host lets an operator
 * select a workspace directory. Backends differ in interaction shape, not
 * just mechanism, so the service exposes a discriminated capability instead
 * of one method set: a `native` backend opens one OS chooser on the
 * host's display, while a `browse` backend serves listing/creation
 * primitives for an in-app browser (and thereby works for remote clients no
 * OS dialog can reach). Consumers switch on `capability().kind`; the union is
 * merge-extensible, and the documented default for an unknown kind is to
 * hide the picking affordance rather than fail. The seam also hosts the two
 * pure helpers every host consumer of its primitives shares: {@link fullyQualified}
 * (the wire-path fence) and {@link raceAbort} (caller-lifetime aborts).
 * @module @deepseek-ai/dsh-host-directory-picker
 */

import { posix, win32 } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import type { DirectoryListing } from './types.ts'

export type { DirectoryEntry, DirectoryListing } from './types.ts'

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
export function fullyQualified(path: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32'
    ? win32.isAbsolute(path) && /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(path)
    : posix.isAbsolute(path)
}

/**
 * The thrown value as an Error (wire/abort reasons may be anything).
 * @param reason - the thrown or aborting value.
 * @returns the value itself when it is an Error, else a fresh Error carrying its string form.
 */
export function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason))
}

/**
 * Await `operation`, but reject with the signal's reason the moment it
 * aborts. Node's filesystem reads are not retractable, so the operation
 * itself keeps running against a handle the caller then closes — its late
 * settlement is swallowed here so an abandoned read cannot surface as an
 * unhandled rejection.
 * @param operation - the in-flight filesystem step.
 * @param signal - caller lifetime; absent means plain awaiting.
 * @returns the operation's value.
 */
export function raceAbort<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      operation.catch(() => {
        // Abandoned read: its handle is being closed by the aborting caller,
        // and the abort reason already carried the outcome.
      })
      reject(asError(signal.reason))
    }
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (reason: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(asError(reason))
      },
    )
  })
}

/** The native interaction: one OS directory chooser on the host display. */
export interface DirectoryPickerNativeCapability {
  kind: 'native'
  /**
   * Open the chooser and wait for the operator.
   * @param signal - caller/connection lifetime; abort terminates the chooser.
   * @returns the chosen absolute path, or null when the operator cancels.
   */
  pick(signal: AbortSignal): Promise<string | null>
}

/**
 * The browse interaction: listing/creation primitives an in-app browser
 * drives one level at a time. Works for remote clients — nothing renders on
 * the host display.
 */
export interface DirectoryPickerBrowseCapability {
  kind: 'browse'
  /**
   * List one directory level.
   * @param path - absolute directory to list; absent lists the home directory.
   * @param signal - caller lifetime; abort stops the scan (a stalled network
   * directory must not outlive a disconnected caller) and rejects with the
   * abort reason.
   * @returns the level's listing with ancestry; backends bound the complete
   * result, and a cut level reports `truncated`.
   * @throws {DirectoryPickerError} `directory-unreadable` when the target is not fully
   * qualified (a wire value must never resolve against the host cwd or, on
   * Windows, its current drive) or cannot be listed.
   */
  list(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  /**
   * Create one child directory under an existing parent.
   * @param path - absolute existing parent directory.
   * @param name - single non-blank path segment (no separators, not `.`/`..`).
   * @returns the created directory's absolute path.
   * @throws {DirectoryPickerError} `directory-exists` for an existing child,
   * `directory-create-failed` for a parent that is not fully qualified or any other failure.
   */
  createDirectory(path: string, name: string): Promise<string>
}

/**
 * Merge-extensible registry of interaction shapes keyed by capability kind: a
 * new backend declaration-merges its shape here (the entry's `kind` literal
 * must equal its key) instead of editing this package.
 */
export interface DirectoryPickerCapabilities {
  native: DirectoryPickerNativeCapability
  browse: DirectoryPickerBrowseCapability
}

/** Union of interaction shapes a backend can provide, derived from the merge-extensible {@link DirectoryPickerCapabilities} map. */
export type DirectoryPickerCapability = DirectoryPickerCapabilities[keyof DirectoryPickerCapabilities]

/** Closed failure vocabulary of the browse primitives (mirrored onto the wire by consumers). */
export type DirectoryPickerErrorCode =
  | 'directory-unreadable'
  | 'directory-exists'
  | 'directory-create-failed'

/** Typed failure thrown by browse primitives so consumers can map business codes without string matching. */
export class DirectoryPickerError extends Error {
  /**
   * @param code - closed business code of the failure.
   * @param path - the absolute path the failure is about.
   * @param message - operator-facing description.
   */
  constructor(readonly code: DirectoryPickerErrorCode, readonly path: string, message: string) {
    super(message)
    this.name = 'DirectoryPickerError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    directoryPicker: DirectoryPicker
  }
}

/**
 * Abstract directory-picking service. Subclass, implement `capability()`, and
 * load the subclass as a plugin — it registers as `ctx.directoryPicker` (one
 * implementation per context; loading a second throws, cordis' standard
 * duplicate-service behavior). The capability object must be stable for the
 * service lifetime: consumers may capture it across calls.
 */
export abstract class DirectoryPicker extends Service {
  constructor(ctx: Context) {
    super(ctx, 'directoryPicker')
  }

  /**
   * The backend's interaction capability.
   * @returns the discriminated capability consumers switch on.
   */
  abstract capability(): DirectoryPickerCapability
}

export default DirectoryPicker
