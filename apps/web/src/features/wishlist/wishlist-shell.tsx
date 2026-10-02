import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { ALL_SECTIONS_VISIBLE, useNavSections } from '@/features/member/use-nav-sections.ts'
import { useSectionNav } from '@/features/member/use-section-nav.ts'
import { useSyncStatus } from '@/features/member/use-sync-status.ts'
import { useSyncedSpace } from '@/features/member/use-synced-space.ts'
import { useMemberUserMenu } from '@/features/member/use-user-menu.ts'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The wishlist area's shell (docs/design/screens/wishlists.html): the
 * member shell with the wishlist section active, a back arrow where the
 * screen sits below the overview, and the user menu the other member areas
 * carry. Everything reads the local store, so the shell answers offline
 * like the screens inside it (ADR-0002). When the owner has hidden the
 * section (ADR-0011), the shell says so instead of rendering a screen
 * whose every request the API answers 404 — the navigation already lacks
 * the item; this covers a direct URL or a stale tab.
 */
export function WishlistShell({
  title,
  backTo,
  width = 'default',
  actions,
  children,
}: {
  title?: string
  backTo?: string
  width?: 'default' | 'narrow' | 'wide'
  actions?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const session = useMemberSessionStatus()
  const sections = useNavSections()
  const snapshot = useSyncedSpace()
  const sync = useSyncStatus()
  const userMenuItems = useMemberUserMenu()
  const onSectionClick = useSectionNav()

  if (session.status === 'pending') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </div>
    )
  }

  // The map is what the device has downloaded; while nothing is, the
  // default is every section visible, the same answer the navigation gives.
  const visibility = snapshot.data?.space?.sections ?? ALL_SECTIONS_VISIBLE
  const screen =
    visibility.wishlist === false ? (
      <Card>
        <Empty>
          <EmptyMedia>
            <Icon name="eye-off" />
          </EmptyMedia>
          <EmptyTitle>{t('wishlist.errors.section_hidden')}</EmptyTitle>
          <EmptyDescription>{t('wishlist.hiddenHint')}</EmptyDescription>
        </Empty>
      </Card>
    ) : (
      children
    )

  return (
    <MemberLayout
      space={{ name: session.me?.space.name ?? '', marks: [] }}
      sections={sections}
      activeId="wishlist"
      sync={sync}
      title={title}
      width={width}
      userMenuItems={userMenuItems}
      actions={visibility.wishlist === false ? undefined : actions}
      back={
        backTo === undefined ? undefined : (
          <Link
            to={backTo}
            aria-label={t('layout.back')}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Icon name="chevron-left" className="size-5" />
          </Link>
        )
      }
      onSectionClick={onSectionClick}
    >
      {screen}
    </MemberLayout>
  )
}
