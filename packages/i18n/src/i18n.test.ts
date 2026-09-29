import { describe, expect, it } from 'vitest'
import { createI18n, defaultLocale, locales } from './index.ts'

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
})
