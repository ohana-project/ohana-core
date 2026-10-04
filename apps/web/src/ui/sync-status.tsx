import { cn } from '@/lib/cn'
import { useTranslation } from 'react-i18next'

import { Icon, type IconName } from '@/ui/icon.tsx'

/*
 * Ohana sync status (`.sync[data-state]` in the prototype), six
 * states: the two in-flight states spin the `sync` glyph (never a ring
 * spinner; reduced motion stops it), the settled states carry their
 * semantic colours, and the two failure states offer a retry link.
 * Compact chip by default, full form via size="lg"; the top-bar chip
 * goes icon-only below 430px (README "Components"), the full form
 * keeps its text.
 */

export type SyncState = 'first' | 'updating' | 'synced' | 'offline' | 'unreachable' | 'error'

const STATES: Record<
  SyncState,
  { icon: IconName; label: string; glyph: string; spinning?: boolean }
> = {
  first: { icon: 'sync', label: 'text-primary', glyph: 'text-primary', spinning: true },
  updating: { icon: 'sync', label: 'text-primary', glyph: 'text-primary', spinning: true },
  synced: { icon: 'check', label: 'text-muted-foreground', glyph: 'text-ok' },
  offline: { icon: 'wifi-off', label: 'text-muted-foreground', glyph: 'text-warn' },
  unreachable: { icon: 'cloud-off', label: 'text-destructive', glyph: 'text-destructive' },
  error: { icon: 'alert', label: 'text-destructive', glyph: 'text-destructive' },
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
  const current = STATES[state]

  const time = syncedAt
    ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(
        syncedAt,
      )
    : undefined

  return (
    <div
      role="status"
      data-slot="sync-status"
      data-state={state}
      data-size={size}
      className={cn(
        'inline-flex min-h-8 items-center gap-[7px] text-sm text-muted-foreground',
        size === 'lg' && 'gap-2',
        current.label,
        className,
      )}
    >
      <Icon
        name={current.icon}
        className={cn(
          'shrink-0',
          size === 'lg' ? 'size-[18px]' : 'size-4',
          current.spinning && 'animate-spin-slow',
          current.glyph,
        )}
      />
      <span className={cn(size === 'default' && 'max-[430px]:sr-only')}>
        {t(`sync.${state}`, { time: time ?? '' })}
      </span>
      {(state === 'unreachable' || state === 'error') && onRetry && (
        <button
          type="button"
          data-slot="sync-retry"
          onClick={onRetry}
          className="font-medium text-primary underline decoration-1 underline-offset-[3px] transition-colors duration-(--t-fast) ease-(--ease) hover:text-accent-strong"
        >
          {t('sync.retry')}
        </button>
      )}
    </div>
  )
}
