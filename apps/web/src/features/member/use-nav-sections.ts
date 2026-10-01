import { useTranslation } from 'react-i18next'
import { useSyncedSpace } from '@/features/member/use-synced-space.ts'
import type { ShellSection } from '@/ui/shell.ts'

/*
 * The member section navigation (docs/design/screens/home.html): home plus
 * the space's visible sections. The map comes from the member's local
 * store (issue #14), so it answers offline exactly as it does online; a
 * section an owner has hidden (issue #13, ADR-0011) disappears for every
 * member. What "unknown" means — every section visible while nothing is
 * downloaded yet — is decided beside the query it comes from
 * (use-synced-space.ts, use-space-settings.ts).
 */

const NAV_SECTIONS = [
  { id: 'journal', labelKey: 'nav.journal', icon: 'book' },
  { id: 'calendar', labelKey: 'nav.calendar', icon: 'calendar' },
  { id: 'wishlist', labelKey: 'nav.wishlist', icon: 'gift' },
] as const

export const ALL_SECTIONS_VISIBLE = { journal: true, calendar: true, wishlist: true } as const

export function useNavSections(): ShellSection[] {
  const { t } = useTranslation()
  const snapshot = useSyncedSpace()
  const visibility = snapshot.data?.space?.sections ?? ALL_SECTIONS_VISIBLE

  const sections: ShellSection[] = [{ id: 'home', label: t('nav.home'), icon: 'home' }]
  for (const section of NAV_SECTIONS) {
    if (visibility[section.id]) {
      sections.push({ id: section.id, label: t(section.labelKey), icon: section.icon })
    }
  }
  return sections
}
