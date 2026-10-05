import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { buttonVariants } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'

/*
 * The shell's back arrow (docs/design/README.md, "Layout"; the
 * prototype's `.btn.btn-icon.m-only` in ohana.js): the 44px round ghost
 * button with an 18px chevron in the main text colour — the button's
 * own container rule sizes the icon — shown below 920px only: from
 * 920px up the sidebar's sections are the way back (issue #62). A real
 * link with the button's classes, like the prototype's styled `<a>`:
 * back is navigation, and Base UI's render prop would turn it into a
 * button in a link's clothing.
 */
export function ShellBackLink({ to }: { to: string }) {
  const { t } = useTranslation()
  return (
    <Link
      to={to}
      aria-label={t('layout.back')}
      className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'desktop:hidden')}
    >
      <Icon name="chevron-left" />
    </Link>
  )
}
