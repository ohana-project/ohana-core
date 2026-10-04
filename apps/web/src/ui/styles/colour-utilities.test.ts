import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve as resolvePath } from 'node:path'
import { Scanner } from '@tailwindcss/oxide'
import { compile } from 'tailwindcss'
import { beforeAll, describe, expect, it } from 'vitest'

/*
 * Every colour utility the client uses must resolve to a rule Tailwind
 * actually generates (issue #56): `border-bg` on the avatar stack rim
 * and `bg-accent-soft` on the calendar's today cell silently styled
 * nothing, because the @theme block names those colours `background`
 * and `primary-soft`. The check extracts the candidates with Tailwind's
 * own scanner, compiles the app's real stylesheet (src/index.css and
 * everything it imports) and requires every colour candidate to appear
 * in the generated CSS.
 */

const webRoot = process.cwd()

/** The files that ship in the client; tests and the test harness do not. */
function sourceFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolvePath(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'testing') walk(path)
      } else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        files.push(path)
      }
    }
  }
  walk(resolvePath(webRoot, 'src'))
  return files
}

/** Colour-consuming utility prefixes, longest first: ring-offset wins over ring. */
const COLOUR_PROPS: readonly string[] = [
  'inset-shadow',
  'placeholder',
  'ring-offset',
  'inset-ring',
  'decoration',
  'outline',
  'accent',
  'border',
  'divide',
  'shadow',
  'stroke',
  'caret',
  'ring',
  'from',
  'text',
  'via',
  'fill',
  'bg',
  'to',
]

/**
 * Known non-colour values per prefix, anchored so a future colour whose
 * name merely starts the same way still gets checked. Widths and numeric
 * positions (`border-2`, `from-10%`, `ring-offset-2`, `shadow-1`) are
 * never colours and are skipped before this table.
 */
const NON_COLOUR: Record<string, RegExp> = {
  text: /^(?:base|xs|sm|md|lg|xl|[2-9]xl|display(?:-lg)?|h[1-3]|body|meta|micro|left|center|right|justify|start|end|balance|pretty|wrap|nowrap|truncate|transform|capitalize|uppercase|lowercase|italic|underline|line-through|no-underline|ellipsis|clip)(?:-|$)/,
  border: /^(?:solid|dashed|dotted|double|hidden|none|collapse|separate|spacing)(?:-|$)/,
  decoration: /^(?:auto|from-font|clone|slice|solid|dashed|dotted|double|wavy|none)(?:-|$)/,
  outline: /^(?:offset|none|hidden|solid|dashed|dotted|double)(?:-|$)/,
  ring: /^(?:inset)(?:-|$)/,
  shadow: /^(?:none|inner|xs|sm|md|lg|xl)(?:-|$)/,
  'inset-shadow': /^(?:none|xs|sm)(?:-|$)/,
  divide: /^(?:x|y|reverse|solid|dashed|dotted|double|none)(?:-|$)/,
  fill: /^(?:none)(?:-|$)/,
  stroke: /^(?:none)(?:-|$)/,
  bg: /^(?:fixed|local|scroll|contain|cover|none|clip|origin|repeat|space|linear|radial|conic|gradient|bottom|top|left|right|center|auto|blend|no-repeat|repeat-(?:x|y))(?:-|$)/,
  accent: /^auto(?:-|$)/,
}

/**
 * Blanks out comments so their prose yields no candidates ("the rim is
 * bg-coloured" must not read as a class). Block comments and line
 * comments following whitespace are removed; `://` in URLs survives.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

/**
 * In css files only @apply carries utilities; declarations such as
 * `text-rendering:` would otherwise read as candidates.
 */
function scannableContent(path: string): { content: string; extension: string } {
  const raw = readFileSync(path, 'utf8')
  if (!path.endsWith('.css')) return { content: stripComments(raw), extension: 'ts' }
  const applies = [...raw.matchAll(/@apply\s+([^;}]+)[;}]/g)].map((m) => m[1]).join('\n')
  return { content: applies, extension: 'css' }
}

interface ColourCandidate {
  /** the full candidate as used in source, variants and all */
  candidate: string
  /** the colour name the candidate points at */
  name: string
}

/** Splits variants on ":" only outside brackets, so data-[a:b]:x survives. */
function splitVariants(candidate: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of candidate) {
    if (ch === '[') depth += 1
    if (ch === ']') depth -= 1
    if (ch === ':' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts
}

function scannedCandidates(): string[] {
  const scanner = new Scanner({})
  return scanner.scanFiles(sourceFiles().map((path) => scannableContent(path)))
}

function colourCandidates(raw: string[]): ColourCandidate[] {
  const found = new Map<string, ColourCandidate>()
  for (const candidate of raw) {
    const parts = splitVariants(candidate)
    const utility = (parts.at(-1) ?? '').replace(/^!/, '')
    const slash = utility.indexOf('/')
    const bare = slash === -1 ? utility : utility.slice(0, slash)
    // split at the first dash after a known prefix, so multi-word colour
    // names (primary-soft, muted-foreground) stay whole
    let prop: string | undefined
    let value: string | undefined
    for (const prefix of COLOUR_PROPS) {
      if (bare.startsWith(`${prefix}-`)) {
        prop = prefix
        value = bare.slice(prefix.length + 1)
        break
      }
    }
    if (!prop || !value) continue
    // arbitrary and CSS-variable values always generate their rule
    if (value.startsWith('[') || value.startsWith('(')) continue
    // a side prefix picks the border's edge; the remainder names the
    // colour, so border-b-bg is checked exactly like border-bg
    if (prop === 'border') {
      const side = value.match(/^(?:t|r|b|l|x|y|s|e)(?:-|$)/)
      if (side) {
        value = value.slice(side[0].length)
        if (!value) continue
      }
    }
    // widths, numeric positions and percentages (border-2, from-10%,
    // ring-offset-4, ring-1.5, the shadow-1/2/3 steps) are never colours
    if (/^[\d.]/.test(value)) continue
    if (NON_COLOUR[prop]?.test(value)) continue
    if (!found.has(candidate)) found.set(candidate, { candidate, name: value })
  }
  return [...found.values()]
}

/**
 * Resolves the stylesheet imports of src/index.css from disk. Bare ids
 * resolve through the package exports; a package that only exports its
 * css under the `style` condition (tw-animate-css) is read via its
 * package.json.
 */
async function loadStylesheet(
  id: string,
  base: string,
): Promise<{ path: string; base: string; content: string }> {
  const req = createRequire(import.meta.url)
  if (id.startsWith('.')) {
    const path = resolvePath(base, id)
    return { path, base, content: readFileSync(path, 'utf8') }
  }
  const attempts = [id, `${id}/index.css`]
  for (const attempt of attempts) {
    try {
      const path = req.resolve(attempt)
      if (path.endsWith('.css')) return { path, base, content: readFileSync(path, 'utf8') }
    } catch {
      // try the next form
    }
  }
  // a package that only exports its css under the `style` condition
  // (tw-animate-css) has no resolvable js entry: read its manifest
  // through the workspace node_modules symlink
  const manifestPath = resolvePath(webRoot, 'node_modules', id, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exports?: Record<string, Record<string, string>>
  }
  const style = manifest.exports?.['.']?.style
  if (!style) throw new Error(`no css entry found for ${id}`)
  const path = resolvePath(manifestPath, '..', style)
  return { path, base, content: readFileSync(path, 'utf8') }
}

/**
 * Whether the compiled stylesheet contains the rule for a candidate.
 * Both sides are compared without selector escaping (`.hover\:bg-x`
 * reads as `.hover:bg-x`): complex arbitrary variants escape far more
 * than the class name itself. The leading dot keeps a bare candidate
 * from matching a variant-carrying emitter of the same utility.
 */
function generates(candidate: string): boolean {
  return generatedCss.replace(/\\/g, '').includes(`.${candidate}`)
}

let rawCandidates: string[]
let candidates: ColourCandidate[]
let generatedCss: string

beforeAll(async () => {
  rawCandidates = scannedCandidates()
  candidates = colourCandidates(rawCandidates)
  const entry = readFileSync(resolvePath(webRoot, 'src/index.css'), 'utf8')
  const compiled = await compile(entry, { base: resolvePath(webRoot, 'src'), loadStylesheet })
  generatedCss = compiled.build(candidates.map((c) => c.candidate))
})

describe('every colour utility used by the client resolves to a generated rule', () => {
  it('collects colour candidates from the real sources', () => {
    const names = new Set(candidates.map((c) => c.name))
    // the extraction is alive: core tokens and the names this issue
    // touched must be present
    for (const name of ['primary', 'background', 'primary-soft']) {
      expect(names.has(name), name).toBe(true)
    }
  })

  it('generates a rule for every colour candidate', () => {
    const missing = candidates.filter((c) => !generates(c.candidate))
    expect(
      missing.map((c) => `${c.candidate} (colour "${c.name}")`),
      'candidates without a generated rule',
    ).toEqual([])
  })

  it('the theme declares every Ohana colour name the client uses', () => {
    const theme = readFileSync(resolvePath(webRoot, 'src/index.css'), 'utf8')
    const themeNames = new Set<string>()
    for (const m of theme.matchAll(/^\s*--color-([\w-]+)\s*:/gm)) {
      if (m[1]) themeNames.add(m[1])
    }
    // names Tailwind always knows, no --color-* token needed
    const alwaysKnown = new Set(['inherit', 'current', 'transparent', 'black', 'white'])
    const unknown = [...new Set(candidates.map((c) => c.name))].filter(
      (name) => !alwaysKnown.has(name) && !themeNames.has(name),
    )
    expect(unknown, 'colour names with no --color-* token in src/index.css').toEqual([])
  })

  it('the client uses none of Tailwind’s default shadow steps', () => {
    // the README allows exactly the three --shadow-* steps; the default
    // scale is dropped by the non-colour filter before classification,
    // so this reads the raw scanner output the classification starts
    // from
    const offenders = rawCandidates
      .map((c) => (splitVariants(c).at(-1) ?? '').replace(/^!/, ''))
      .filter((u) => /^shadow-(?:2xs|xs|sm|md|lg|xl|2xl)(?:\/|$)/.test(u))
    expect(offenders, 'candidates from the default shadow scale').toEqual([])
  })
})
