import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { StoredMemberProfile } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { useWishlistData } from './use-wishlist.ts'
import { authorName, openWishesOf, wishesOf } from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * The wishlists overview (docs/design/screens/wishlists.html): the member's
 * own wishlist card beside the other members' lists with their open-wish
 * counts. Everything reads the member's synchronised partition (issue
 * #14), so the screen answers the same online and offline (ADR-0002).
 * Favorites and reservations join this screen with issue #19; the wish
 * rules themselves are #18's.
 */
export function WishlistsScreen() {
  const { t } = useTranslation()
  const { snapshot, wishes, profiles, downloaded } = useWishlistData()
  const meId = getActiveMemberId()

  const mine = meId === undefined ? [] : wishesOf(wishes, meId)
  const mineOpen = openWishesOf(wishes, meId ?? '')
  const mineReceived = mine.length - mineOpen.length
  const others = profiles.filter((profile) => profile.id !== meId)

  return (
    <WishlistShell
      title={t('wishlist.title')}
      width="narrow"
      actions={
        <Button size="sm" render={<Link to="/wishlist/mine" />}>
          <Icon name="plus" />
          {t('wishlist.addWish')}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 pt-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-display">{t('wishlist.subtitle')}</h1>
        </div>

        {snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : !downloaded ? (
          // A device with nothing downloaded says so for the whole section:
          // counting the own list, or the members it happens to hold, would
          // be a claim the device cannot make (ADR-0014).
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="cloud-off" />
              </EmptyMedia>
              <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
              <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
            </Empty>
          </Card>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <SectionHeader title={t('wishlist.myWishlist')} />
              <Link to="/wishlist/mine" className="block">
                <Card hoverable>
                  <div className="flex items-center gap-3">
                    <span className="grid size-[38px] shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                      <Icon name="gift" className="size-5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-semibold">{t('wishlist.myWishlist')}</span>
                      <span className="text-sm text-muted-foreground">
                        {t('wishlist.openCount', { count: mineOpen.length })}
                        {mineReceived > 0 && (
                          <> · {t('wishlist.receivedCount', { count: mineReceived })}</>
                        )}
                      </span>
                    </div>
                    <Icon name="chevron-right" className="text-muted-foreground" />
                  </div>
                </Card>
              </Link>
            </div>

            <div className="flex flex-col gap-3">
              <SectionHeader title={t('wishlist.members')} />
              {others.length === 0 ? (
                <Card>
                  <Empty>
                    <EmptyMedia>
                      <Icon name="users" />
                    </EmptyMedia>
                    <EmptyTitle>{t('wishlist.noMembersTitle')}</EmptyTitle>
                    <EmptyDescription>{t('wishlist.noMembersText')}</EmptyDescription>
                  </Empty>
                </Card>
              ) : (
                <Card className="py-0">
                  <ul className="divide-y divide-border">
                    {others.map((profile) => (
                      <MemberWishlistRow
                        key={profile.id}
                        profile={profile}
                        openCount={openWishesOf(wishes, profile.id).length}
                      />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </WishlistShell>
  )
}

function MemberWishlistRow({
  profile,
  openCount,
}: {
  profile: StoredMemberProfile
  openCount: number
}) {
  const { t } = useTranslation()
  const name = authorName(profile.id, [profile], t('wishlist.authorUnknown'))
  return (
    <li>
      <Link
        to="/wishlist/$memberId"
        params={{ memberId: profile.id }}
        className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent"
      >
        <Avatar size="sm" hue={hueFromId(profile.id)}>
          <AvatarFallback>{monogramOf(name)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">{name}</span>
          <span className="text-sm text-muted-foreground">
            {t('wishlist.openCount', { count: openCount })}
          </span>
        </div>
        <Icon name="chevron-right" className="text-muted-foreground" />
      </Link>
    </li>
  )
}
