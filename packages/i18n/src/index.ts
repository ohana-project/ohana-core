import i18next from 'i18next'
import ICU from 'i18next-icu'
// The import attributes are required at runtime: the api ships as TS source
// executed by node's type stripping, and ESM refuses JSON without them.
import en from './resources/en.json' with { type: 'json' }
import ru from './resources/ru.json' with { type: 'json' }

export const locales = ['ru', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'ru'

/**
 * The device's preferred locale: the first navigator language the
 * catalogues speak, else the default. The onboarding screen reaches for
 * it when neither the member nor the device has a stored choice (issue
 * #78); outside a browser it is the default.
 */
export function deviceLocale(): Locale {
  // The package runs outside a browser too, where there is no navigator
  // — and its tsconfig knows no DOM lib, so the global is read untyped.
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } })
    .navigator
  if (nav === undefined) return defaultLocale
  for (const candidate of nav.languages ?? [nav.language]) {
    if (candidate === undefined) continue
    const base = candidate.split('-')[0]?.toLowerCase()
    const locale = locales.find((locale) => locale === base)
    if (locale !== undefined) return locale
  }
  return defaultLocale
}

const resources = {
  ru: { translation: ru },
  en: { translation: en },
}

export function createI18n(options: { locale?: Locale } = {}) {
  const instance = i18next.createInstance()
  instance.use(ICU)
  void instance.init({
    resources,
    lng: options.locale ?? defaultLocale,
    fallbackLng: defaultLocale,
    interpolation: { escapeValue: false },
  })
  return instance
}

declare module 'i18next' {
  interface CustomTypeOptions {
    resources: typeof resources
  }
}
