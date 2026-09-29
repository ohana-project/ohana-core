import { cn } from 'cn'
import { useTranslation } from 'react-i18next'

import { Icon, type IconName } from '@/ui/icon.tsx'

/*
 * Ohana sync status (`.sync[data-state]` in the prototype), six
 * states: the two in-flight states spin the `sync` glyph (never a
 * ring spinner; reduced motion stops it), synced/online carry their
 * semantic colours, and the two failure states offer a retry link.
 * Compact chip by default, full form via size="lg"; below 430px the
 * top-bar chip hides its text.
 */

export type SyncState = 'first' | 'updating' | 'synced' | 'offline' | 'unreachable' | 'error'

const STATE_ICONS: Record<SyncState, IconName> = {
  first: 'sync',
  updating: 'sync',
  synced: 'check',
  offline: 'wifi-off',
  unreachable: 'cloud-off',
  error: 'alert',
}

const STATE_STYLES: Record<SyncState, string> = {
  first: 'text-primary',
  updating: 'text-primary',
  synced: 'text-muted-foreground',
  offline: 'text-muted-foreground',
  unreachable: 'text-destructive',
  error: 'text-destructive',
}

export interface SyncStatusProps {
  state: SyncState
  /** When the space last synced; shown in the synced state. */
  syncedAt?: Date | number
  size?: 'default' | 'lg'
  onRetry?: () => void
  className?: string
}

export function SyncStatus({
  state,
  syncedAt,
  size = 'default',
  onRetry,
  className,
}: SyncStatusProps) {
  const { t, i18n } = useTranslation()

  const time = syncedAt
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
        syncedAt,
      )
    : undefined

  const text: Record<SyncState, string> = {
    first: t('sync.first'),
    updating: t('sync.updating'),
    synced: t('sync.synced', { time: time ?? '' }),
    offline: t('sync.offline'),
    unreachable: t('sync.unreachable'),
    error: t('sync.error'),
  }

  const canRetry = (state === 'unreachable' || state === 'error') && onRetry

  return (
    <div
      role="status"
      data-slot="sync-status"
      data-state={state}
      data-size={size}
      className={cn(
        'inline-flex min-h-8 items-center gap-[7px] text-[13px] text-muted-foreground',
        size === 'lg' && 'min-h-8 gap-2 text-sm',
        STATE_STYLES[state],
        className,
      )}
    >
      <Icon
        name={STATE_ICONS[state]}
        className={cn(
          size === 'lg' ? 'size-[18px]' : 'size-4',
          (state === 'first' || state === 'updating') && 'animate-spin-slow text-primary',
          state === 'synced' && 'text-ok',
          state === 'offline' && 'text-warn',
        )}
      />
      <span className="max-[430px]:hidden">{text[state]}</span>
      {canRetry && (
        <button
          type="button"
          data-slot="sync-retry"
          onClick={onRetry}
          className="font-medium text-primary underline decoration-1 underline-offset-[3px] transition-colors hover:text-[color-mix(in_oklch,var(--accent)_85%,black)] dark:hover:text-[color-mix(in_oklch,var(--accent)_90%,white)]"
        >
          {t('sync.retry')}
        </button>
      )}
    </div>
  )
}
