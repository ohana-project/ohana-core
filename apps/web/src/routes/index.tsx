import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { HealthCard } from '../features/health/health-card.tsx'
import { LanguageSwitcher } from '../features/language/language-switcher.tsx'

function HomePage() {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">{t('app.title')}</h1>
      <LanguageSwitcher />
      <HealthCard />
    </main>
  )
}

export const Route = createFileRoute('/')({
  component: HomePage,
})
