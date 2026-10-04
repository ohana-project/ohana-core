import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'ohana.theme'

/**
 * The browser chrome's colours (docs/design/README.md, "Colour"): the
 * sRGB fallbacks index.html's theme-color metas carry, collapsed onto
 * the resolved theme by the provider and the pre-paint script.
 */
export const THEME_COLOR = {
  light: 'rgb(246 241 238)',
  dark: 'rgb(117 34 49)',
} as const

function loadThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // Storage can be unavailable (private mode); the choice just does not persist.
  }
  return 'system'
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice !== 'system') return choice
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface ThemeContextValue {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setTheme: (choice: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Keeps data-theme on <html> always set to the resolved value, so the
 * palette never has a no-attribute mode. The member's choice is stored
 * per device; "system" follows prefers-color-scheme live. The inline
 * script in index.html applies the same logic before first paint.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<ThemeChoice>(loadThemeChoice)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(choice))

  useEffect(() => {
    document.documentElement.dataset.theme = resolved
    // The browser chrome follows the choice too: index.html's two
    // media-keyed metas only know the system scheme, so once the
    // provider runs they collapse onto the resolved theme's colour —
    // the sRGB fallbacks of docs/design/README.md, "Colour" (≈ bg in
    // the light theme, ≈ accent in the dark).
    const color = resolved === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.removeAttribute('media')
      meta.content = color
    }
  }, [resolved])

  useEffect(() => {
    if (choice !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolved(media.matches ? 'dark' : 'light')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [choice])

  const setTheme = useCallback((next: ThemeChoice) => {
    setChoice(next)
    setResolved(resolveTheme(next))
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Still applied for this session.
    }
  }, [])

  const value = useMemo(() => ({ choice, resolved, setTheme }), [choice, resolved, setTheme])

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme is only valid inside <ThemeProvider>')
  return ctx
}
