import { type Locale, locales } from '@ohana/i18n'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/button'
import { storeLocale } from '../../lib/language.ts'

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation()

  const changeLanguage = (locale: Locale) => {
    void i18n.changeLanguage(locale)
    storeLocale(locale)
  }

  return (
    <fieldset className="flex gap-2">
      <legend className="sr-only">{t('language.label')}</legend>
      {locales.map((locale) => (
        <Button
          key={locale}
          variant={i18n.resolvedLanguage === locale ? 'default' : 'outline'}
          aria-pressed={i18n.resolvedLanguage === locale}
          onClick={() => changeLanguage(locale)}
        >
          {t(`language.${locale}`)}
        </Button>
      ))}
    </fieldset>
  )
}
