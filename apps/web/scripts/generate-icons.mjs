/*
 * Generates the PWA icon PNGs from public/favicon.svg (issue #11): the
 * flower sits centred on the full-bleed petal background, so every surface
 * — square, circle and maskable — shows the same mark. Run with:
 *   pnpm --filter @ohana/web exec node scripts/generate-icons.mjs
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const svg = await readFile(join(root, 'public', 'favicon.svg'), 'utf8')
const outDir = join(root, 'public', 'icons')
await mkdir(outDir, { recursive: true })

// The background matches the favicon's own rounded-rect fill, so the tile
// reads as full-bleed in every mask; scale 1.1 slightly enlarges the flower
// for masks that crop to a circle (its petals stay within the safe zone).
const BACKGROUND = '#F5D8D5'

const targets = [
  { file: 'pwa-192.png', size: 192, scale: 1.0 },
  { file: 'pwa-512.png', size: 512, scale: 1.0 },
  { file: 'pwa-maskable-512.png', size: 512, scale: 1.1 },
  { file: 'apple-touch-icon.png', size: 180, scale: 1.1 },
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 })

for (const { file, size, scale } of targets) {
  const art = size * scale
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(
    `<style>svg{width:100%;height:100%;display:block}</style>
     <body style="margin:0;background:${BACKGROUND};display:grid;place-items:center;overflow:hidden">
       <div style="width:${art}px;height:${art}px">${svg}</div>
     </body>`,
  )
  await page.screenshot({ path: join(outDir, file) })
  console.log(`wrote public/icons/${file} (${size}x${size})`)
}

await browser.close()
