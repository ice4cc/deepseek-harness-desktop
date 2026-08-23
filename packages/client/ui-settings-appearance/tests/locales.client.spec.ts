/** Dictionary parity and the level-to-key mapping. */
import { describe, expect, it } from 'vitest'
import { CONTENT_WIDTH_LEVELS } from '../src/appearance-settings.ts'
import { en, levelKey, zh, type AppearanceSettingsKey } from '../src/client/locales.ts'

describe('appearance dictionaries', () => {
  it('carries the same keys in both languages with non-empty copy', () => {
    // Object.keys returns string[] for a keyed Record; the keys are structurally the union.
    const zhKeys = Object.keys(zh) as AppearanceSettingsKey[]
    const enKeys = Object.keys(en) as AppearanceSettingsKey[]
    expect(zhKeys.sort()).toEqual(enKeys.sort())
    for (const key of zhKeys) {
      expect(zh[key]).not.toBe('')
      expect(en[key]).not.toBe('')
    }
  })

  it('maps every width level to its own label key', () => {
    for (const level of CONTENT_WIDTH_LEVELS) {
      const key = levelKey(level)
      expect(key).toBe(`level.${level}`)
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
  })
})
