import { cn } from '@/lib/cn'
import { useTranslation } from 'react-i18next'

import { Button } from '@/ui/button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'

/*
 * The empty-state layout with a danger tone and a retry action, for
 * failures that leave a screen (or a feed) without content.
 */
export function ErrorState({
  onRetry,
  title,
  description,
  className,
}: {
  onRetry?: () => void
  /** Defaults to the shared «Не получилось загрузить» copy. */
  title?: React.ReactNode
  description?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <Empty className={cn('py-8', className)}>
      <EmptyMedia className="bg-destructive/13 text-destructive">
        <Icon name="alert" />
      </EmptyMedia>
      <EmptyTitle>{title ?? t('ui.errorTitle')}</EmptyTitle>
      <EmptyDescription>{description ?? t('ui.errorDescription')}</EmptyDescription>
      {onRetry && (
        <EmptyContent>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            {t('ui.retry')}
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}
