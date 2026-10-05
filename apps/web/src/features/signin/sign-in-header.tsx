import { cn } from '@/lib/cn'

import { Logo } from '@/ui/logo.tsx'

/*
 * The centred header of the sign-in screens that carry the logo in the
 * prototype (code entry, install): the wordmark lockup centred 18px
 * above the display heading, then the muted lead capped to the
 * prototype's own character count (`.center` block, `.logo`,
 * `.display.display-xl`).
 */
export function SignInHeader({
  title,
  lead,
  leadClassName = 'max-w-[32ch]',
  className,
}: {
  title: string
  lead: string
  /** The lead's width cap: 32ch on code entry, 34ch on install. */
  leadClassName?: string
  className?: string
}) {
  return (
    <div className={cn('mb-7 text-center', className)}>
      <Logo className="mx-auto mb-4.5 justify-center" />
      <h1 className="mb-2.5 text-display">{title}</h1>
      <p className={cn('mx-auto text-body text-muted-foreground', leadClassName)}>{lead}</p>
    </div>
  )
}
