/** Contract behavior the seam itself owns: registration identity, typed failures, and the shared helpers. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DirectoryPicker, DirectoryPickerError, fullyQualified, raceAbort } from '../src/index.ts'
import type { DirectoryPickerCapability } from '../src/index.ts'

/** Minimal concrete backend: all a subclass owes the abstract class is capability(). */
class StubPicker extends DirectoryPicker {
  private readonly stub: DirectoryPickerCapability = { kind: 'native', pick: async () => null }
  capability(): DirectoryPickerCapability {
    return this.stub
  }
}

describe('DirectoryPicker seam', () => {
  it('registers a subclass as ctx.directoryPicker and leaves with its fiber', async () => {
    const ctx = new Context()
    const fiber = ctx.plugin(StubPicker)
    await fiber.await()
    expect(ctx.get('directoryPicker')).toBeInstanceOf(StubPicker)
    expect(ctx.get('directoryPicker')!.capability().kind).toBe('native')
    await fiber.dispose()
    expect(ctx.get('directoryPicker')).toBeUndefined()
  })

  it('carries the business code and subject path on DirectoryPickerError', () => {
    const failure = new DirectoryPickerError('directory-exists', '/home/u/x', '/home/u/x already exists')
    expect(failure.name).toBe('DirectoryPickerError')
    expect(failure.code).toBe('directory-exists')
    expect(failure.path).toBe('/home/u/x')
    expect(failure.message).toContain('already exists')
    expect(failure).toBeInstanceOf(Error)
  })

  it('classifies fully qualified paths per platform (drive-less rooted Windows forms rejected)', () => {
    expect(fullyQualified('/home/x', 'linux')).toBe(true)
    expect(fullyQualified('x/y', 'darwin')).toBe(false)
    expect(fullyQualified('C:\\projects', 'win32')).toBe(true)
    expect(fullyQualified('C:/projects', 'win32')).toBe(true)
    expect(fullyQualified('\\\\server\\share', 'win32')).toBe(true)
    expect(fullyQualified('//server/share/deep', 'win32')).toBe(true)
    // Rooted but drive-less: isAbsolute accepts these, yet resolve() would
    // inject the process's current drive.
    expect(fullyQualified('\\foo', 'win32')).toBe(false)
    expect(fullyQualified('/foo', 'win32')).toBe(false)
    expect(fullyQualified('C:relative', 'win32')).toBe(false)
    // Incomplete UNC prefixes collapse to drive-relative roots under resolve().
    expect(fullyQualified('\\\\', 'win32')).toBe(false)
    expect(fullyQualified('\\\\server', 'win32')).toBe(false)
    expect(fullyQualified('\\\\server\\', 'win32')).toBe(false)
  })

  it('raceAbort follows the operation until the signal wins, and swallows the abandoned settlement', async () => {
    // No signal / settled operations: plain passthrough, listener removed.
    await expect(raceAbort(Promise.resolve('ok'), undefined)).resolves.toBe('ok')
    const live = new AbortController()
    await expect(raceAbort(Promise.resolve('ok'), live.signal)).resolves.toBe('ok')
    // Failure passthrough keeps the operation's own error.
    await expect(raceAbort(Promise.reject(new Error('raw failure')), live.signal)).rejects.toThrow('raw failure')
    // The abort wins over a pending operation and carries its own reason;
    // the operation's late rejection is swallowed, never unhandled.
    const rejections: unknown[] = []
    const onUnhandled = (reason: unknown): void => { rejections.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    try {
      let rejectLate!: (reason: unknown) => void
      const pending = new Promise<never>((_resolve, reject) => { rejectLate = reject })
      const controller = new AbortController()
      const raced = raceAbort(pending, controller.signal)
      // A bare-string abort reason exercises the Error wrap.
      controller.abort('caller left')
      await expect(raced).rejects.toThrow('caller left')
      rejectLate(new Error('late read failure'))
      await new Promise(resolve => setTimeout(resolve, 10))
      expect(rejections).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})
