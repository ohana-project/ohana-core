import { useTranslation } from 'react-i18next'
import { useTheme } from '@/app/theme.tsx'
import { Button } from '@/ui/button.tsx'
import { Icon } from '@/ui/icon.tsx'

/*
 * The round theme toggle of the shells (issue #63): a plain icon button
 * that shows the theme one tap away — the moon in the light theme, the
 * sun in the dark, like the prototype's `data-action="theme"` buttons —
 * and flips the theme in place, no reload and no lost session. The
 * choice persists per device and follows the system setting until made
 * (app/theme.tsx). The prototype's sign-in screens place it fixed at the
 * top right; the administrative bar renders the 36px round size.
 */
export function ThemeToggle({
  size = 'icon',
  className,
}: {
  /** 44px round by default; the administrative bar takes the 36px round. */
  size?: 'icon' | 'icon-sm'
  className?: string
}) {
  const { t } = useTranslation()
  const { resolved, setTheme } = useTheme()
  const dark = resolved === 'dark'

  return (
    <Button
      variant="ghost"
      size={size}
      className={className}
      aria-label={dark ? t('layout.theme.light') : t('layout.theme.dark')}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </Button>
  )
}
