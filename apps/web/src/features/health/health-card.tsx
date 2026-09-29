import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card'
import { useApiHealth } from './use-api-health.ts'

const checkNames = ['database', 'storage'] as const

export function HealthCard() {
  const { t } = useTranslation()
  const { data: report, isPending, isError } = useApiHealth()

  let body: ReactNode
  if (isPending) {
    body = <p className="text-sm text-muted-foreground">{t('health.loading')}</p>
  } else if (isError || !report) {
    body = <p className="text-sm text-destructive">{t('health.unreachable')}</p>
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">{t(`health.status.${report.status}`)}</p>
        <ul className="flex flex-col gap-1 text-sm">
          {checkNames.map((check) => (
            <li key={check} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t(`health.checks.${check}`)}</span>
              <span>{t(`health.state.${report.checks[check]}`)}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t('health.title')}</CardTitle>
        <CardDescription>{t('health.description')}</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
