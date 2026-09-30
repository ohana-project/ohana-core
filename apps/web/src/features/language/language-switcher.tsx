import { type Locale, locales } from '@ohana/i18n'
import { useTranslation } from 'react-i18next'
import { storeLocale } from '@/lib/locale-storage.ts'
import { Button } from '@/ui/button'

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
          variant={i18n.resolvedLanguage === locale ? 'primary' : 'secondary'}
          aria-pressed={i18n.resolvedLanguage === locale}
          onClick={() => changeLanguage(locale)}
        >
          {t(`language.${locale}`)}
        </Button>
      ))}
    </fieldset>
  )
}
