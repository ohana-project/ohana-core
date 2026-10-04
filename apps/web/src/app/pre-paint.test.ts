import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { THEME_COLOR } from './theme.tsx'

/*
 * The pre-paint script of index.html mirrors the theme provider
 * (app/theme.tsx) before any code loads: it resolves the stored choice
 * or the system scheme onto <html> and carries it into the browser
 * chrome. The script is extracted and run against jsdom, so removing
 * its chrome logic, moving the metas below it, or letting either side's
 * colour literals drift from THEME_COLOR fails here — the e2e specs
 * cannot catch that, because the mounted provider writes the same
 * values the script was supposed to.
 */

// The vitest run's working directory is apps/web.
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

function prePaintScript(): string {
  // The bare <script> is the pre-paint one; the module script carries
  // attributes, so the bracket rules it out.
  const match = html.match(/<script>([\s\S]*?)<\/script>/)
  if (match?.[1] === undefined) throw new Error('index.html carries no inline pre-paint script')
  return match[1]
}

function runPrePaint() {
  new Function(prePaintScript())()
}

function seedMetas() {
  // index.html's two media-keyed metas, as the browser sees them before
  // the script runs.
  for (const scheme of ['light', 'dark'] as const) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('media', `(prefers-color-scheme: ${scheme})`)
    meta.setAttribute('content', scheme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light)
    document.head.appendChild(meta)
  }
}

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.remove()
  })
})

describe('the index.html pre-paint script', () => {
  it('carries the same colours as the provider', () => {
    const contents = [...html.matchAll(/<meta name="theme-color"[^>]*content="([^"]*)"/g)].map(
      (match) => match[1],
    )
    expect(contents).toEqual([THEME_COLOR.light, THEME_COLOR.dark])
  })

  it('resolves a stored dark choice onto html and the chrome before paint', () => {
    window.localStorage.setItem('ohana.theme', 'dark')
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('dark')
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
    expect(metas.map((meta) => meta.getAttribute('content'))).toEqual([
      THEME_COLOR.dark,
      THEME_COLOR.dark,
    ])
    for (const meta of metas) {
      expect(meta).not.toHaveAttribute('media')
    }
  })

  it('follows the system scheme with no stored choice', () => {
    seedMetas()

    runPrePaint()

    // jsdom's matchMedia stub answers light (src/testing/setup.ts).
    expect(document.documentElement.dataset.theme).toBe('light')
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')]
    expect(metas.map((meta) => meta.getAttribute('content'))).toEqual([
      THEME_COLOR.light,
      THEME_COLOR.light,
    ])
  })
})
