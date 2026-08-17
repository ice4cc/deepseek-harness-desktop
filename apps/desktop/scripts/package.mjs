/**
 * Stage and package the desktop app.
 *
 * 1. Verifies the dsh build artifacts exist (`pnpm run build` from the repo root).
 * 2. Deploys a self-contained production installation of @deepseek-ai/dsh into
 *    `out/dsh` via `pnpm deploy --legacy --prod` (real node_modules, no workspace links).
 *    Packages that the closure references only as peerDependencies are invisible to
 *    pnpm's deploy closure, so they are added to the deploy target's dependencies for
 *    the duration of the deploy and the manifest is restored afterwards.
 * 3. Repairs the isolated store layout for the plain-Node runtime: flattens every
 *    store-only package into a top-level node_modules link, materializes the
 *    `link:`-overridden vendored packages (pnpm deploy preserves them as links
 *    escaping into the source checkout), and prunes any remaining foreign or
 *    dangling symlinks.
 * 4. Runs electron-builder, which carries `out/dsh` as `resources/dsh`.
 *
 * Usage: `node scripts/package.mjs [--mac] [--win] [--linux]` (default: the current platform).
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPO_ROOT = path.resolve(APP_DIR, '..', '..')
const DEPLOY_DIR = path.join(APP_DIR, 'out', 'dsh')
const CLI_PACKAGE_JSON = path.join(REPO_ROOT, 'apps', 'cli', 'package.json')

/**
 * Run a command in the repository root, streaming its output.
 * @param {string} command - executable name.
 * @param {string[]} args - argument list.
 */
function run(command, args) {
  // shell: true resolves pnpm through PATHEXT on Windows (pnpm.cmd).
  execFileSync(command, args, { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
}

/** Locate a workspace package directory by its npm name, or undefined. */
function locateWorkspacePackage(name) {
  const bases = ['vendor', 'packages', 'apps', path.join('native', 'landlock-run')]
  for (const base of bases) {
    const root = path.join(REPO_ROOT, base)
    if (!existsSync(root)) continue
    for (const entry1 of readdirSync(root, { withFileTypes: true })) {
      if (!entry1.isDirectory()) continue
      const dir1 = path.join(root, entry1.name)
      if (manifestOf(dir1)?.name === name) return dir1
      for (const entry2 of readdirSync(dir1, { withFileTypes: true })) {
        if (!entry2.isDirectory()) continue
        const dir2 = path.join(dir1, entry2.name)
        if (manifestOf(dir2)?.name === name) return dir2
      }
    }
  }
  return undefined
}

/** Read a package.json from a directory, tolerating absence or parse errors. */
function manifestOf(dir) {
  const file = path.join(dir, 'package.json')
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Add a top-level symlink for every package that pnpm's isolated store keeps
 * out of the root node_modules. The dsh profile boot resolves plugin imports
 * with literal-path node_modules walks from the installation anchor, which
 * cannot see through the top-level symlinks into `.pnpm` virtual directories;
 * a flat layout (what a plain npm install produces) makes every closure
 * package resolvable from any anchor.
 * @param {string} deployDir - directory holding the deployed node_modules.
 * @returns {number} number of links added.
 */
function flattenNodeModules(deployDir) {
  const nm = path.join(deployDir, 'node_modules')
  const store = path.join(nm, '.pnpm')
  if (!existsSync(store)) return 0
  let linked = 0
  for (const entry of readdirSync(store)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const inner = path.join(store, entry, 'node_modules')
    if (!existsSync(inner)) continue
    for (const pkg of readdirSync(inner)) {
      const names = pkg.startsWith('@') ? readdirSync(path.join(inner, pkg)).map((n) => `${pkg}/${n}`) : [pkg]
      for (const name of names) {
        const target = path.join(inner, name)
        if (!existsSync(path.join(target, 'package.json'))) continue
        const top = path.join(nm, name)
        if (existsSync(top)) continue
        // Relative target so the artifact stays relocatable on any machine.
        mkdirSync(path.dirname(top), { recursive: true })
        symlinkSync(path.relative(path.dirname(top), target), top, 'dir')
        linked++
      }
    }
  }
  return linked
}

/**
 * Copy the workspace's `link:`-override packages (the vendored, re-scoped
 * Cordis foundation) into the deployment and redirect every in-tree link to
 * them. pnpm deploy preserves those overrides as links escaping back into the
 * source checkout — the installation only boots while it sits inside that
 * checkout, which a distributed artifact must not depend on.
 * @param {string} deployDir - directory holding the deployed node_modules.
 * @returns {{ packages: number, redirected: number }} work done.
 */
function materializeLinkedPackages(deployDir) {
  const workspaceYaml = readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const overrides = []
  for (const line of workspaceYaml.split('\n')) {
    const match = line.match(/^\s*['"]?([^'":\s][^'":]*?)['"]?\s*:\s*['"]link:([^'"]+)['"]\s*(?:#.*)?$/)
    if (match !== null) overrides.push({ name: match[1], sourceDir: path.join(REPO_ROOT, match[2]) })
  }
  const nm = path.join(deployDir, 'node_modules')
  const root = realpathSync(deployDir) + path.sep
  let packages = 0
  let redirected = 0
  for (const { name, sourceDir } of overrides) {
    if (!existsSync(path.join(sourceDir, 'package.json'))) continue
    // Canonical slot inside the store; one copy serves every reference.
    const slot = path.join(nm, '.pnpm', `local+${name.replace('/', '+')}@1`, 'node_modules', name)
    if (!existsSync(slot)) {
      mkdirSync(path.dirname(slot), { recursive: true })
      cpSync(sourceDir, slot, { recursive: true, filter: (src) => path.basename(src) !== 'node_modules' })
      packages++
    }
    // Redirect every in-tree link to this package that escapes the deployment.
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isSymbolicLink()) {
          const isPackageLink = full.endsWith(path.join('node_modules', ...name.split('/')))
          let resolved = undefined
          try {
            resolved = realpathSync(full)
          } catch {
            resolved = undefined // dangling link
          }
          if (isPackageLink && (resolved === undefined || !resolved.startsWith(root))) {
            rmSync(full, { force: true })
            symlinkSync(path.relative(path.dirname(full), slot), full, 'dir')
            redirected++
          }
        } else if (entry.isDirectory()) {
          walk(full)
        }
      }
    }
    walk(nm)
    // Top-level link so flat resolution finds the package from any anchor.
    const top = path.join(nm, name)
    if (!existsSync(top)) {
      mkdirSync(path.dirname(top), { recursive: true })
      symlinkSync(path.relative(path.dirname(top), slot), top, 'dir')
    }
  }
  return { packages, redirected }
}

/**
 * Remove every symlink that does not resolve to a path inside the deployment.
 * pnpm's deploy preserves the workspace's `link:vendor/*` overrides as links
 * escaping back into the source checkout (dangling on any other machine), and
 * can leave plain dangling links behind; electron-builder stats every file it
 * copies and fails hard on either, while a self-contained artifact must not
 * reference paths outside itself. The flat top level plus the store entries
 * shadow every pruned link at runtime.
 * @param {string} deployDir - deployment root used as the containment boundary.
 * @param {string} nodeModulesDir - directory to prune.
 * @returns {number} number of links removed.
 */
function pruneForeignSymlinks(deployDir, nodeModulesDir) {
  const root = realpathSync(deployDir) + path.sep
  let removed = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        let resolved = undefined
        try {
          resolved = realpathSync(full)
        } catch {
          resolved = undefined // dangling link
        }
        if (resolved === undefined || !resolved.startsWith(root)) {
          rmSync(full, { force: true })
          removed++
        }
      } else if (entry.isDirectory()) {
        walk(full)
      }
    }
  }
  walk(nodeModulesDir)
  return removed
}

/**
 * Walk the dependency closure of @deepseek-ai/dsh (dependencies and
 * peerDependencies) and return the workspace packages that appear only as
 * peer dependencies — pnpm deploy never includes those in its output.
 * @returns {string[]} package names to inject for the deploy.
 */
function computePeerOnlyPackages() {
  const seen = new Set()
  const referencedAsDependency = new Set()
  const queue = ['@deepseek-ai/dsh']
  while (queue.length > 0) {
    const name = queue.shift()
    if (seen.has(name)) continue
    seen.add(name)
    const manifest = locateWorkspacePackage(name) ? manifestOf(locateWorkspacePackage(name)) : undefined
    if (manifest === undefined) continue
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      referencedAsDependency.add(dep)
      if (dep.startsWith('@deepseek-ai/') && !seen.has(dep)) queue.push(dep)
    }
    for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
      if (peer.startsWith('@deepseek-ai/') && !seen.has(peer)) queue.push(peer)
    }
  }
  return [...seen].filter((name) => name !== '@deepseek-ai/dsh' && !referencedAsDependency.has(name))
}

for (const artifact of [path.join(REPO_ROOT, 'apps/cli/lib/bin.js'), path.join(REPO_ROOT, 'apps/web/dist/index.html')]) {
  if (!existsSync(artifact)) {
    console.error(`missing build artifact ${artifact}; run \`pnpm run build\` from the repository root first`)
    process.exit(1)
  }
}

// No flag: electron-builder targets the current platform by default. An empty
// string argument is rejected ("Unknown argument"), so pass nothing instead.
const platformFlag = process.argv.slice(2).find((arg) => ['--mac', '--win', '--linux'].includes(arg)) ?? null

rmSync(path.join(APP_DIR, 'out'), { recursive: true, force: true })

// pnpm deploy resolves the closure from dependencies alone; peer-only packages
// (capability Service Definitions and similar seams) would be missing from the
// installed node_modules and fail at boot. Inject them temporarily.
const originalManifest = readFileSync(CLI_PACKAGE_JSON, 'utf8')
const manifest = JSON.parse(originalManifest)
const injected = computePeerOnlyPackages()
manifest.dependencies ??= {}
for (const name of injected) manifest.dependencies[name] = 'workspace:^'
writeFileSync(CLI_PACKAGE_JSON, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`deploying @deepseek-ai/dsh production installation (+${injected.length} peer-only packages)...`)
try {
  // --legacy: pnpm v10+ workspaces default to inject-workspace-packages deploy,
  // which rewrites workspace: ranges; the legacy mode keeps the real dependency
  // closure we need for a self-contained runtime.
  run('pnpm', ['--filter', '@deepseek-ai/dsh', 'deploy', '--legacy', '--prod', DEPLOY_DIR])
  const linked = flattenNodeModules(DEPLOY_DIR)
  console.log(`flattened ${linked} store-only packages into the top-level node_modules`)
  const materialized = materializeLinkedPackages(DEPLOY_DIR)
  if (materialized.packages > 0) {
    console.log(`materialized ${String(materialized.packages)} link-overridden packages (${String(materialized.redirected)} links redirected)`)
  }
  const pruned = pruneForeignSymlinks(DEPLOY_DIR, path.join(DEPLOY_DIR, 'node_modules'))
  if (pruned > 0) console.log(`removed ${String(pruned)} foreign or dangling symlinks from node_modules`)
} finally {
  writeFileSync(CLI_PACKAGE_JSON, originalManifest)
}

console.log('building electron artifact...')
const isWin = process.platform === 'win32'
const builder = path.join(APP_DIR, 'node_modules', '.bin', isWin ? 'electron-builder.cmd' : 'electron-builder')
// shell: true is required on Windows to spawn .cmd files (EINVAL without it).
execFileSync(builder, platformFlag ? [platformFlag] : [], { cwd: APP_DIR, stdio: 'inherit', shell: isWin })
