/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-doc-panel`.
 * @module @deepseek-ai/dsh-client-ui-doc-panel/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-doc-panel'

/** Cordis companion plugin name. */
export const name = 'client-ui-doc-panel-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a pure-consumer plugin that derives its rows in-component
 * from the standard useSessions/useProjection delivery and reads files through the
 * workspaces service — it emits no cordis events and owns no cross-plugin mutable
 * state; derivation, rendering, and interaction behavior are asserted directly by
 * this package's store/component specs.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
