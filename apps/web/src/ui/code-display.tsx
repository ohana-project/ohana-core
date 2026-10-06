import { useTranslation } from 'react-i18next'
import { writeClipboard } from '@/lib/clipboard.ts'
import { cn } from '@/lib/cn'

import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'
import { toast } from '@/ui/toast.tsx'

/*
 * Ohana code display (`.code-display` in the prototype): an access
 * code shown once, mono on a dashed accent fill, selectable with one
 * tap (user-select: all), with a copy action beside it. `copy="none"`
 * drops the beside-button for screens that carry the copy in their own
 * footer — the administrative issue dialog's labelled button beside
 * «Готово» (admin-space.html).
 */
export function CodeDisplay({
  code,
  copy = 'beside',
  className,
}: {
  code: string
  copy?: 'beside' | 'none'
  className?: string
}) {
  const { t } = useTranslation()

  const write = async () => {
    // The clipboard may be absent or refuse; the code stays selectable.
    if (await writeClipboard(code)) toast(t('ui.copied'))
  }

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div
        data-slot="code-display"
        className="min-w-0 flex-1 rounded-lg border-[1.5px] border-dashed border-[color-mix(in_oklch,var(--accent)_45%,transparent)] bg-primary-soft px-4 py-[18px] text-center font-mono text-[clamp(26px,6vw,34px)] font-medium tracking-[0.14em] uppercase tabular-nums text-foreground select-all"
      >
        {code}
      </div>
      {copy === 'beside' ? (
        <Button
          variant="secondary"
          size="icon"
          aria-label={t('ui.copy')}
          onClick={() => {
            void write()
          }}
        >
          <Icon name="copy" />
        </Button>
      ) : null}
    </div>
  )
}
