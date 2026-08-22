/**
 * @deepseek-ai/dsh-desktop — generates the platform app icons from
 * `assets/app-icon/mark.svg` (the official Figma-extract DeepSeek whale mark,
 * brand blue #4D6BFE on transparent).
 *
 * Writes the electron-builder build resources under `build/`:
 *   - `icon.icns`  macOS — 824×824 white rounded tile (radius 185, the Big
 *     Sur icon grid) on a 1024 canvas, mark 400 px tall; converted by the OS
 *     `iconutil` (macOS only — run this script on a Mac for the icns).
 *   - `icon.ico`   Windows — full-bleed white square, mark 400 px tall,
 *     PNG-compressed entries 16–256 (the container is assembled here; no
 *     dependency in this repo writes ICO).
 *   - `icon.png`   Linux — 512×512 full-bleed white square (same art as the
 *     ico; electron-builder's stock Linux icon slot).
 *
 * White tile, blue mark: the mark keeps ample negative space (400 px on a
 * 1024 canvas) so it does not crowd the tile.
 * @module @deepseek-ai/dsh-desktop/generate-icons
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(HERE, '..')
const MARK_SVG = path.join(APP_ROOT, 'assets', 'app-icon', 'mark.svg')
const BUILD_DIR = path.join(APP_ROOT, 'build')

/** Render canvas for every variant. */
const SIZE = 1024
/** macOS Big Sur icon grid: tile inset and corner radius on the 1024 canvas. */
const TILE = { inset: 100, size: 824, radius: 185 }
/** White tile background. */
const BACKGROUND = { r: 255, g: 255, b: 255 }
/**
 * Mark content height (the mark is wider than tall, 23.16:17.04). Kept small
 * relative to the canvas for generous negative space.
 */
const MARK_HEIGHT = { mac: 400, square: 400 }

/**
 * Render the mark at high resolution, trim to its alpha bounds, and return the
 * trimmed buffer plus its target-size dimensions.
 * @param {number} targetHeight - the final mark content height in px.
 * @returns {Promise<{ buffer: Buffer, width: number, height: number }>}
 */
async function markAt(targetHeight) {
  // Vector render: the SVG declares a 23.16 px box; density scales it 1:1 to a
  // 2048 px raster so trimming and downscaling work on full-resolution data.
  const meta = await sharp(readFileSync(MARK_SVG), { density: (96 * 2048) / 23.16 })
    .trim()
    .resize({ height: targetHeight, kernel: 'lanczos3' })
    .png()
    .toBuffer({ resolveWithObject: true })
  return { buffer: meta.data, width: meta.info.width, height: meta.info.height }
}

/**
 * Compose the mark centered on a 1024 canvas.
 * @param {{ buffer: Buffer, width: number, height: number }} mark - trimmed, resized mark.
 * @param {'mac' | 'square'} variant - rounded tile (mac) or full-bleed square.
 * @returns {Promise<Buffer>} the 1024×1024 PNG.
 */
async function compose(mark, variant) {
  const base =
    variant === 'mac'
      ? sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">` +
              `<rect x="${TILE.inset}" y="${TILE.inset}" width="${TILE.size}" height="${TILE.size}" rx="${TILE.radius}" fill="#ffffff"/>` +
              '</svg>',
          ),
        )
      : sharp({
          create: { width: SIZE, height: SIZE, channels: 4, background: { ...BACKGROUND, alpha: 1 } },
        })
  return base
    .png()
    .composite([
      {
        input: mark.buffer,
        left: Math.round((SIZE - mark.width) / 2),
        top: Math.round((SIZE - mark.height) / 2),
      },
    ])
    .png()
    .toBuffer()
}

/**
 * Write the macOS iconset and convert it to icns with the OS `iconutil`.
 * @param {Buffer} master - the 1024 macOS variant PNG.
 * @returns {Promise<void>}
 */
async function writeIcns(master) {
  const iconset = path.join(BUILD_DIR, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const entries = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ]
  for (const [size, name] of entries) {
    writeFileSync(
      path.join(iconset, name),
      await sharp(master).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer(),
    )
  }
  if (process.platform !== 'darwin') {
    throw new Error('iconutil is a macOS tool; run generate-icons.mjs on a Mac to produce icon.icns')
  }
  const out = path.join(BUILD_DIR, 'icon.icns')
  execFileSync('iconutil', ['-c', 'icns', '-o', out, iconset])
  rmSync(iconset, { recursive: true, force: true })
}

/**
 * Assemble a PNG-compressed ICO container (entries sorted ascending, the 256
 * entry encoded as 0 in the width/height fields per the ICO spec).
 * @param {{ size: number, png: Buffer }[]} entries - PNG payloads.
 * @returns {Buffer} the .ico file bytes.
 */
function icoBuffer(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const directory = Buffer.alloc(entries.length * 16)
  let offset = 6 + entries.length * 16
  entries.forEach((entry, i) => {
    const b = i * 16
    const dim = entry.size === 256 ? 0 : entry.size
    directory.writeUInt8(dim, b)
    directory.writeUInt8(dim, b + 1)
    directory.writeUInt16LE(1, b + 4) // planes
    directory.writeUInt16LE(32, b + 6) // bits per pixel
    directory.writeUInt32LE(entry.png.length, b + 8)
    directory.writeUInt32LE(offset, b + 12)
    offset += entry.png.length
  })
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)])
}

/**
 * Build every platform artifact from the mark source.
 * @returns {Promise<void>}
 */
async function main() {
  mkdirSync(BUILD_DIR, { recursive: true })

  const macMaster = await compose(await markAt(MARK_HEIGHT.mac), 'mac')
  const squareMaster = await compose(await markAt(MARK_HEIGHT.square), 'square')
  writeFileSync(path.join(BUILD_DIR, 'icon-mac-1024.png'), macMaster)
  writeFileSync(path.join(BUILD_DIR, 'icon-square-1024.png'), squareMaster)

  await writeIcns(macMaster)

  const icoEntries = [16, 24, 32, 48, 64, 128, 256].map(async (size) => ({
    size,
    png: await sharp(squareMaster).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer(),
  }))
  writeFileSync(path.join(BUILD_DIR, 'icon.ico'), icoBuffer(await Promise.all(icoEntries)))

  writeFileSync(
    path.join(BUILD_DIR, 'icon.png'),
    await sharp(squareMaster).resize(512, 512, { kernel: 'lanczos3' }).png().toBuffer(),
  )

  console.log(`wrote ${path.join(BUILD_DIR, 'icon.icns')}, icon.ico, icon.png (plus the two 1024 master PNGs)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})