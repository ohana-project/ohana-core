import { cn } from '@/lib/cn'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/ui/icon.tsx'

/*
 * Ohana loading indicator: the rotating pair-of-arrows `sync` glyph —
 * ring spinners are an anti-pattern in this design system. It also
 * backs the sync status; the motion stops under reduced-motion.
 */
function Spinner({ className, ...props }: Omit<React.ComponentProps<'svg'>, 'name'>) {
  const { t } = useTranslation()
  return (
    <Icon
      name="sync"
      data-slot="spinner"
      role="status"
      aria-label={t('ui.loading')}
      className={cn('animate-spin text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Spinner }
