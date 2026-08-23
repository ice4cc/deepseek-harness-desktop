import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const verifier = fileURLToPath(new URL('../scripts/verify-official-build.mjs', import.meta.url))
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Create a temp repo root carrying the given build record (or none). @returns the root path. */
function fixtureRoot(record: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-verify-build-'))
  roots.push(root)
  if (record !== undefined) {
    mkdirSync(join(root, '.dsh-build'), { recursive: true })
    writeFileSync(
      join(root, '.dsh-build', 'client-build-environment.json'),
      typeof record === 'string' ? record : `${JSON.stringify(record, null, 2)}\n`,
    )
  }
  return root
}

function officialRecord(environment: Record<string, string> | undefined = undefined): unknown {
  return {
    formatVersion: 1,
    environment: environment ?? {
      DSH_CLIENT_BUILD_PROFILE: 'official',
      DSH_CLIENT_COMMIT_HASH: '715b874',
      DSH_CLIENT_TITLE: 'DeepSeek Harness',
    },
    artifacts: { fileCount: 202, sha256: 'a'.repeat(64) },
  }
}

function verify(root: string) {
  return spawnSync(process.execPath, [verifier, '--root', root], { encoding: 'utf8', timeout: 5_000 })
}

describe('desktop packaging official-build verifier', () => {
  it('accepts an official client build record', () => {
    const result = verify(fixtureRoot(officialRecord()))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('client build record is official')
  })

  it('rejects a default (local-profile) build record', () => {
    const result = verify(fixtureRoot(officialRecord({ DSH_CLIENT_COMMIT_HASH: '715b874' })))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('DSH_CLIENT_BUILD_PROFILE=unset')
    expect(result.stderr).toContain('build:official')
  })

  it('rejects a record with an explicit non-official profile', () => {
    const result = verify(fixtureRoot(officialRecord({ DSH_CLIENT_BUILD_PROFILE: 'local' })))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('DSH_CLIENT_BUILD_PROFILE="local"')
  })

  it('rejects a missing record', () => {
    const result = verify(fixtureRoot(undefined))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('missing')
    expect(result.stderr).toContain('build:official')
  })

  it('rejects an unreadable record', () => {
    const result = verify(fixtureRoot('{ not json'))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unreadable')
  })
})
