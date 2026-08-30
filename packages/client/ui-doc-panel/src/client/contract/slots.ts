/**
 * Document panel slot contract: the registrant-side props composition for the
 * layout-owned `docPanel` single seat (the third grid column of AppFrame).
 * The occupant owns the column's content; its geometry — open/closed and
 * width — lives in the layout store and reaches the component as the owner
 * share plus the ctx.layout panel actions. Session business data arrives
 * through the standard useSessions delivery, never owner props.
 */
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls ui-layout's SlotMap merge (the 'docPanel' entry) and the
// ctx.layout augmentation into every program that sees this contract, so
// PropsRuntime<'docPanel'> resolves.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: merges the fileChanges key into SessionProjectionMap for the
// useSessions projectionValues reads.
import type {} from '@deepseek-ai/dsh-file-changes/client'
// Type-only: pulls ui-session's GlobalStandardProps merge (useSessions).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { createDocPanelStore } from '../store.ts'

/** The result of a workspaces text read: decoded content + baseline, or the wire error code. */
export type DocReadResult = { ok: true; content: string; version: string } | { ok: false; code: string }

/** The result of a workspaces text write: the fresh baseline, or the wire error code. */
export type DocSaveResult = { ok: true; version: string; size: number } | { ok: false; code: string }

/**
 * Registrant-private injected share (arrives via the register inject factory):
 * the workspaces read/write bound to the store and the panel transitions on the
 * ctx.layout face, closed over the apply ctx. Components never see ctx or the
 * service objects — only these callbacks.
 */
export type DocPanelInjected = {
  /**
   * Read one file through the workspaces service and land the result on the
   * tab (content + baseline on success, the wire error code on failure). No-op
   * for a path with no open tab; resolves once the read settles.
   */
  readFile: (path: string) => Promise<DocReadResult>
  /**
   * Write one file's full content through the workspaces service. A supplied
   * expectedVersion guards against clobbering a changed file; omitted it
   * overwrites unconditionally. Resolves with the fresh baseline or the code.
   */
  saveFile: (path: string, content: string, expectedVersion?: string) => Promise<DocSaveResult>
  /** Open the panel column (no-op when already open; restores the contract default width after a close). */
  openPanel: () => void
  /** Close the panel column (forgets the drag width; the layout store owns it). */
  closePanel: () => void
}

/**
 * Full component props: the root-scope runtime share with the frame's live
 * column state as owner params, this entry's store seat, the injected
 * callbacks, and the standard locale seat. No children slots are declared —
 * the panel is a leaf surface.
 */
export type DocPanelRootComponentProps =
  PropsRuntime<'docPanel'>
  & PropsStore<ReturnType<typeof createDocPanelStore>>
  & DocPanelInjected
  & PropsLocale<'docPanel'>
