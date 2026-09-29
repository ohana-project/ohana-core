import { defaultLocale, type Locale, locales } from '@ohana/i18n'

const storageKey = 'ohana.locale'

export function loadLocale(): Locale {
  const stored = window.localStorage.getItem(storageKey)
  return locales.find((locale) => locale === stored) ?? defaultLocale
}

export function storeLocale(locale: Locale): void {
  window.localStorage.setItem(storageKey, locale)
}
