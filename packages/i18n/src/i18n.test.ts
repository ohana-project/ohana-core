import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n, defaultLocale, deviceLocale, locales } from './index.ts'
import en from './resources/en.json'
import ru from './resources/ru.json'

const catalogues = { ru, en }

function* strings(node: unknown, path: string[] = []): Generator<[string, string]> {
  if (typeof node === 'string') yield [path.join('.'), node]
  else if (node && typeof node === 'object')
    for (const [key, value] of Object.entries(node)) yield* strings(value, [...path, key])
}

describe('createI18n', () => {
  it('defaults to Russian with catalogues for every locale', () => {
    expect(defaultLocale).toBe('ru')
    expect(locales).toEqual(['ru', 'en'])
    expect(createI18n().language).toBe('ru')
  })

  it('uses the Russian plural categories for 1, 2 and 5', () => {
    const i18n = createI18n({ locale: 'ru' })
    expect(i18n.t('members.count', { count: 1 })).toBe('1 участник')
    expect(i18n.t('members.count', { count: 2 })).toBe('2 участника')
    expect(i18n.t('members.count', { count: 5 })).toBe('5 участников')
    expect(i18n.t('members.count', { count: 21 })).toBe('21 участник')
  })

  it('uses the English plural categories', () => {
    const i18n = createI18n({ locale: 'en' })
    expect(i18n.t('members.count', { count: 1 })).toBe('1 member')
    expect(i18n.t('members.count', { count: 5 })).toBe('5 members')
  })

  it.each(locales)('uses ICU single-brace interpolation in every %s string', (locale) => {
    for (const [key, value] of strings(catalogues[locale])) {
      expect(
        value,
        `${locale}: ${key} uses i18next {{ }} syntax, which ICU renders literally`,
      ).not.toContain('{{')
    }
  })

  it.each(locales)('interpolates the card meta line in %s', (locale) => {
    const i18n = createI18n({ locale })
    expect(i18n.t('designPreview.lists.cardMeta', { date: '28.09', author: 'Миша' })).toBe(
      '28.09 · Миша',
    )
  })
})

describe('deviceLocale', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('takes the first navigator language the catalogues speak', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'en-US', 'ru'] })
    expect(deviceLocale()).toBe('en')
  })

  it('reads the plain language tag when there is no language list', () => {
    vi.stubGlobal('navigator', { language: 'ru-RU' })
    expect(deviceLocale()).toBe('ru')
  })

  it('keeps the default when the device speaks neither catalogue', () => {
    vi.stubGlobal('navigator', { languages: ['fr-FR', 'de-DE'] })
    expect(deviceLocale()).toBe(defaultLocale)
  })

  it('is the default outside a browser', () => {
    vi.stubGlobal('navigator', undefined)
    expect(deviceLocale()).toBe(defaultLocale)
  })
})
