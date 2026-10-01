import { createI18n } from '@ohana/i18n'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { ThemeProvider } from '@/app/theme.tsx'
import { loadLocale } from '@/lib/locale-storage.ts'
import { Toaster } from '@/ui/toast.tsx'

export function AppProviders({ children }: { children: ReactNode }) {
  // Failures surface in the UI instead of hiding behind query retries;
  // retries are the sync engine's job once synchronised data lands.
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const [i18n] = useState(() => createI18n({ locale: loadLocale() }))

  useEffect(() => {
    document.documentElement.lang = i18n.language
    const onLanguageChanged = (language: string) => {
      document.documentElement.lang = language
    }
    i18n.on('languageChanged', onLanguageChanged)
    return () => {
      i18n.off('languageChanged', onLanguageChanged)
    }
  }, [i18n])

  return (
    <ThemeProvider>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
      </I18nextProvider>
    </ThemeProvider>
  )
}
