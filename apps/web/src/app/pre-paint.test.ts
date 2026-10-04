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
 * script, breaking the system-following (query included), the stored
 * choice's precedence, or the fallback for «system», invalid values,
 * and unavailable storage, or letting either side's colour literals
 * drift from THEME_COLOR — all fail here. The e2e specs cannot catch
 * these: they retry until the mounted provider has written the very
 * values the script was supposed to.
 */

// The vitest run's working directory is apps/web, like the sibling
// file-reading tests (src/lib/cn.test.ts).
const html = readFileSync(resolve('index.html'), 'utf8')
const page = new DOMParser().parseFromString(html, 'text/html')

const prePaint = page.querySelector('script:not([src])')
if (prePaint === null || prePaint.textContent === null || prePaint.textContent.trim() === '') {
  throw new Error('index.html carries no inline pre-paint script')
}
const script = prePaint

function runPrePaint() {
  new Function(script.textContent)()
}

// The mock answers the query it is asked, so an inverted or mistyped
// `(prefers-color-scheme: …)` in the script fails the suite instead of
// agreeing with a fixed truth. The comparison is the exact string, on
// purpose: the script and the provider spell the query identically.
function systemScheme(scheme: 'light' | 'dark') {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: query === `(prefers-color-scheme: ${scheme})` }) as MediaQueryList,
  )
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
  it('sit in exactly one inline script, the one these tests run', () => {
    expect(page.querySelectorAll('script:not([src])')).toHaveLength(1)
  })

  it('map each system scheme to its colour, in the metas that precede the script', () => {
    const metas = [...page.querySelectorAll('meta[name="theme-color"]')]
    expect(metas.map((meta) => [meta.getAttribute('media'), meta.getAttribute('content')])).toEqual(
      [
        ['(prefers-color-scheme: light)', THEME_COLOR.light],
        ['(prefers-color-scheme: dark)', THEME_COLOR.dark],
      ],
    )
    // The behavioural tests only seed what a real browser has parsed
    // when the script runs; both metas have to precede it.
    for (const meta of metas) {
      expect(script.compareDocumentPosition(meta) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    }
  })

  it('lets a stored dark choice beat a light system scheme', () => {
    window.localStorage.setItem('ohana.theme', 'dark')
    systemScheme('light')
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(chromeContents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    chromeKeepsNoMediaKeys()
  })

  it('follows a light system scheme with no stored choice', () => {
    systemScheme('light')
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('light')
    expect(chromeContents()).toEqual([THEME_COLOR.light, THEME_COLOR.light])
    chromeKeepsNoMediaKeys()
  })

  it('follows a dark system scheme with no stored choice', () => {
    systemScheme('dark')
    seedMetas()

    runPrePaint()

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(chromeContents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    chromeKeepsNoMediaKeys()
  })

  for (const scheme of ['light', 'dark'] as const) {
    it(`follow the system scheme on a stored «system» choice under a ${scheme} system`, () => {
      window.localStorage.setItem('ohana.theme', 'system')
      systemScheme(scheme)
      seedMetas()

      runPrePaint()

      expect(document.documentElement.dataset.theme).toBe(scheme)
      expect(chromeContents()).toEqual([THEME_COLOR[scheme], THEME_COLOR[scheme]])
      chromeKeepsNoMediaKeys()
    })

    it(`treat an invalid stored value as no choice at all under a ${scheme} system`, () => {
      window.localStorage.setItem('ohana.theme', 'garbage')
      systemScheme(scheme)
      seedMetas()

      runPrePaint()

      // Not «garbage» on <html>: the value falls back to the system scheme.
      expect(document.documentElement.dataset.theme).toBe(scheme)
      expect(chromeContents()).toEqual([THEME_COLOR[scheme], THEME_COLOR[scheme]])
      chromeKeepsNoMediaKeys()
    })
  }

  it('follow the system scheme when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    systemScheme('dark')
    seedMetas()

    runPrePaint()

    // The palette still resolves: no flash from a script that died
    // reaching for the stored choice it cannot have.
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(chromeContents()).toEqual([THEME_COLOR.dark, THEME_COLOR.dark])
    chromeKeepsNoMediaKeys()
  })
})

describe('the manifest colours', () => {
  it('carry THEME_COLOR.light, which the manifest cannot follow a choice with', () => {
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
})
