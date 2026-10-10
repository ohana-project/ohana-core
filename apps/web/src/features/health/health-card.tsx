import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/ui/card'
import { type ApiHealthReport, useApiHealth } from './use-api-health.ts'

const healthChecks: readonly (keyof ApiHealthReport['checks'])[] = ['database', 'storage']

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
          {healthChecks.map((check) => (
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
    // The padded card takes plain children — the content sets its own
    // rhythm (README "Cards").
    <Card variant="padded" className="w-full max-w-sm">
      <h3 className="text-h3">{t('health.title')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t('health.description')}</p>
      <div className="mt-3">{body}</div>
    </Card>
  )
}
