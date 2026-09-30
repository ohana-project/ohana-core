import { cn } from 'cn'
import { useTranslation } from 'react-i18next'

import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'
import { toast } from '@/ui/toast.tsx'

/*
 * Ohana code display (`.code-display` in the prototype): an invite
 * code shown once, mono on a dashed accent fill, selectable with one
 * tap (user-select: all), with a copy action beside it.
 */
export function CodeDisplay({ code, className }: { code: string; className?: string }) {
  const { t } = useTranslation()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast(t('ui.copied'))
    } catch {
      // The code stays selectable; nothing to report.
    }
  }

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        data-slot="code-display"
        className="min-w-0 flex-1 rounded-lg border-[1.5px] border-dashed border-[color-mix(in_oklch,var(--accent)_45%,transparent)] bg-primary-soft px-4 py-[18px] text-center font-mono text-[clamp(26px,6vw,34px)] font-medium tracking-[0.14em] uppercase tabular-nums text-foreground select-all"
      >
        {code}
      </div>
      <Button
        variant="secondary"
        size="icon"
        aria-label={t('ui.copy')}
        onClick={() => {
          void copy()
        }}
      >
        <Icon name="copy" />
      </Button>
    </div>
  )
}
