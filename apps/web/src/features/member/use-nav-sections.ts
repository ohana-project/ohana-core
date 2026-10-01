import { useTranslation } from 'react-i18next'
import { useMemberSpace } from '@/features/space-settings/use-space-settings.ts'
import type { ShellSection } from '@/ui/shell.ts'

/*
 * The member section navigation (docs/design/screens/home.html): home plus
 * the space's visible sections. A section an owner has hidden (issue #13,
 * ADR-0011) disappears for every member. The space settings are online-only
 * data until the sync engine arrives (issue #14), so while they are loading
 * or unreachable the navigation shows every section rather than none.
 */

const NAV_SECTIONS = [
  { id: 'journal', labelKey: 'nav.journal', icon: 'book' },
  { id: 'calendar', labelKey: 'nav.calendar', icon: 'calendar' },
  { id: 'wishlist', labelKey: 'nav.wishlist', icon: 'gift' },
] as const

export function useNavSections(): ShellSection[] {
  const { t } = useTranslation()
  const space = useMemberSpace()
  const visibility = space.data?.sections

  const sections: ShellSection[] = [{ id: 'home', label: t('nav.home'), icon: 'home' }]
  for (const section of NAV_SECTIONS) {
    if (visibility === undefined || visibility[section.id]) {
      sections.push({ id: section.id, label: t(section.labelKey), icon: section.icon })
    }
  }
  return sections
}
