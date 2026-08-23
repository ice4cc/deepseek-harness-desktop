/**
 * Verify that the current client build record describes an official build.
 *
 * A plain `pnpm run build` embeds no DSH_CLIENT_BUILD_PROFILE, and the
 * assembled GUI then renders the local "DSH Local Build" mark. This guard
 * makes that misconfiguration fail at packaging time instead of surfacing
 * as wrong branding in a distributed artifact.
 *
 * Usage: `node scripts/verify-official-build.mjs [--root <repo-root>]`
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const DEFAULT_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { root: { type: 'string' } },
})
const root = resolve(values.root ?? DEFAULT_ROOT)
const recordPath = resolve(root, '.dsh-build', 'client-build-environment.json')

function fail(message) {
  console.error(`desktop packaging: ${message}`)
  process.exit(1)
}

if (!existsSync(recordPath)) {
  fail(`client build record .dsh-build/client-build-environment.json is missing under ${root}; run \`pnpm run build:official\` from the repository root first`)
}

let parsed
try {
  parsed = JSON.parse(readFileSync(recordPath, 'utf8'))
} catch (error) {
  fail(`client build record is unreadable (${error instanceof Error ? error.message : String(error)}); rerun \`pnpm run build:official\``)
}

const profile = typeof parsed?.environment?.DSH_CLIENT_BUILD_PROFILE === 'string'
  ? parsed.environment.DSH_CLIENT_BUILD_PROFILE
  : undefined
if (profile !== 'official') {
  fail(`the current client build carries DSH_CLIENT_BUILD_PROFILE=${profile === undefined ? 'unset' : JSON.stringify(profile)}; the desktop package requires an official build — rerun \`pnpm run build:official\` and repackage`)
}

console.log('desktop packaging: client build record is official')
