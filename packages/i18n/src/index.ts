import i18next from 'i18next'
import ICU from 'i18next-icu'
// The import attributes are required at runtime: the api ships as TS source
// executed by node's type stripping, and ESM refuses JSON without them.
import en from './resources/en.json' with { type: 'json' }
import ru from './resources/ru.json' with { type: 'json' }

export const locales = ['ru', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'ru'

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
