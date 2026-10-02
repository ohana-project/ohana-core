import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { useWishlistData } from './use-wishlist.ts'
import { WishRow } from './wish-row.tsx'
import { authorName, openWishesOf, wishlistUpdatedAt } from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * One member's wishlist (docs/design/screens/wishlist-person.html): the
 * open wishes they are hoping for, creation order — a received wish has
 * left the open wishes (issue #18), and the favorites and reservations
 * that share this prototype screen join with issue #19. The wishes read
 * from the synchronised partition, so the screen answers offline like the
 * rest of the section (ADR-0002).
 */
export function WishlistPersonScreen({ memberId }: { memberId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, wishes, profiles, downloaded } = useWishlistData()
  const meId = getActiveMemberId()

  const isMe = memberId === meId
  useEffect(() => {
    if (isMe) void navigate({ to: '/wishlist/mine', replace: true })
  }, [isMe, navigate])

  const profile = profiles.find((candidate) => candidate.id === memberId)
  const name = authorName(memberId, profiles, t('wishlist.authorUnknown'))
  const open = openWishesOf(wishes, memberId)
  const updated = wishlistUpdatedAt(open)

  return (
    <WishlistShell title={t('wishlist.personTitle', { name })} backTo="/wishlist" width="narrow">
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : !downloaded ? (
        // Before anything else: a device with nothing downloaded — or a
        // fraction left by an owed replay — says so, instead of reading the
        // absent profile as a missing member or counting the rows it
        // happens to hold (ADR-0014, architecture.md web rules).
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        </Card>
      ) : profile === undefined ? (
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="users" />
            </EmptyMedia>
            <EmptyTitle>{t('wishlist.memberMissingTitle')}</EmptyTitle>
            <EmptyDescription>{t('wishlist.memberMissingText')}</EmptyDescription>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 pt-6">
          <div className="flex items-center gap-3">
            <Avatar size="lg" hue={hueFromId(memberId)}>
              <AvatarFallback>{monogramOf(name)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="text-h3">{name}</span>
              <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
                {updated === undefined
                  ? t('wishlist.openCount', { count: open.length })
                  : `${t('wishlist.openCount', { count: open.length })} · ${t('wishlist.updated', {
                      moment: personMoment(updated, i18n.language),
                    })}`}
              </span>
            </div>
          </div>

          {open.length === 0 ? (
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="gift" />
                </EmptyMedia>
                <EmptyTitle>{t('wishlist.personEmptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('wishlist.personEmptyText')}</EmptyDescription>
              </Empty>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((wish) => (
                <WishRow key={wish.id} wish={wish} />
              ))}
            </div>
          )}

          <p className="text-meta text-muted-foreground">{t('wishlist.personHint')}</p>
        </div>
      )}
    </WishlistShell>
  )
}

/** The person screen's meta line, "вчера в 21:04" style kept simple: the
 *  localized moment the list was last touched. */
function personMoment(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .toLocaleLowerCase(locale)
}
