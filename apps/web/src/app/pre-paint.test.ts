import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THEME_COLOR } from './theme.tsx'

/*
 * The pre-paint script of index.html mirrors the theme provider
 * (app/theme.tsx) before any code loads: it resolves the stored choice
 * or the system scheme onto <html> and carries the choice into the
 * browser chrome. The real document is parsed here and its script run
 * against bare jsdom — where nothing but the script writes — so
 * removing the script's chrome logic, moving the metas below the
 * script, breaking the system-following or the stored choice's
 * precedence, or letting either side's colour literals drift from
 * THEME_COLOR fails here. The e2e specs cannot catch these: they retry
 * until the mounted provider has written the very values the script
 * was supposed to.
 */

// The vitest run's working directory is apps/web, like the sibling
// file-reading tests (src/lib/cn.test.ts).
const html = readFileSync(resolve('index.html'), 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')

const prePaint = page.querySelector('script:not([src])')
if (prePaint === null || prePaint.textContent === null) {
  throw new Error('index.html carries no inline pre-paint script')
}
const script = prePaint

function runPrePaint() {
  new Function(script.textContent)()
}

function seedMetas() {
  // Only the metas a real browser has parsed when the script runs: the
  // ones preceding it in index.html.
  for (const meta of page.querySelectorAll('meta[name="theme-color"]')) {
    if (script.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_PRECEDING) {
      document.head.appendChild(meta.cloneNode())
    }
  }
}

function chromeContents(): (string | null)[] {
  return [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
    meta.getAttribute('content'),
  )
}

function chromeKeepsNoMediaKeys() {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    expect(meta).not.toHaveAttribute('media')
  }
}

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.remove()
  })
  vi.restoreAllMocks()
})

describe('the pre-paint theme colours', () => {
  it('map each system scheme to its colour, in the metas that precede the script', () => {
    const metas = [...page.querySelectorAll('meta[name="theme-color"]')]
    expect(metas.map((meta) => [meta.getAttribute('media'), meta.getAttribute('content')])).toEqual(
      [
        ['(prefers-color-scheme: light)', THEME_COLOR.light],
        ['(prefers-color-scheme: dark)', THEME_COLOR.dark],
      ],
    )
  })

  it('carry THEME_COLOR.light into the manifest, which cannot follow a choice', () => {
    const config = readFileSync(resolve('vite.config.ts'), 'utf8')
    const rgb = THEME_COLOR.light.match(/rgb\((\d+) (\d+) (\d+)\)/)
    if (rgb === null) throw new Error('THEME_COLOR.light is not an rgb() triplet')
    const hex = `#${rgb
      .slice(1)
      .map((channel) => Number(channel).toString(16).padStart(2, '0'))
      .join('')}`
    expect(config).toContain(`theme_color: '${hex}'`)
    expect(config).toContain(`background_color: '${hex}'`)
  })

  it('resolve a stored dark choice onto html and the chrome before paint', () => {
    window.localStorage.setItem('ohana.theme', 'dark')
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(chromeContents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    chromeKeepsNoMediaKeys()
  })

  it('follow a light system scheme with no stored choice', () => {
    seedMetas()

    runPrePaint()

    // jsdom's matchMedia stub answers light (src/testing/setup.ts).
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(chromeContents()).toEqual([THEME_COLOR.light, THEME_COLOR.light])
    chromeKeepsNoMediaKeys()
  })

  it('follow a dark system scheme with no stored choice', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(chromeContents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    chromeKeepsNoMediaKeys()
  })

  it('let a stored light choice beat a dark system scheme', () => {
    window.localStorage.setItem('ohana.theme', 'light')
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList)
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(chromeContents()).toEqual([THEME_COLOR.light, THEME_COLOR.light])
    chromeKeepsNoMediaKeys()
  })
})
