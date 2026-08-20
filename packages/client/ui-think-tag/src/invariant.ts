/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-think-tag`.
 * @module @deepseek-ai/dsh-client-ui-think-tag/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-think-tag'

/** Cordis companion plugin name. */
export const name = 'client-ui-think-tag-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the control is a slot effect whose declaration,
 * registration, and teardown are exercised by this package's suites; the
 * tagged draft text flows through the ui-conversation input machine, which
 * owns the draft/content relation it would guard.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
