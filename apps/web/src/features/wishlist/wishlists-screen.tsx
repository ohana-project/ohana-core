import { Link } from '@tanstack/react-router'
import type { Locale } from '@ohana/i18n'
import { useTranslation } from 'react-i18next'
import { formatDayLong, parseDateOnly } from '@/lib/calendar-dates.ts'
import type { StoredMemberProfile } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/ui/item.tsx'
import { NoteBlock } from '@/ui/note-block.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { useWishlistData } from './use-wishlist.ts'
import {
  authorName,
  favoritesWithWishes,
  nearBirthdays,
  openWishesOf,
  reservationFor,
  wishesOf,
  type NearBirthday,
} from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * The wishlists overview (docs/design/screens/wishlists.html): the
 * «Вишлисты» heading with its muted subtitle, the member's own list as an
 * avatar-led link card, the members' rows with their inline counts and
 * status lines, and the aside holding the birthday note, the surprise rule
 * and the favourites link (issue #66). From 920px the screen is the
 * prototype's 1.6fr / 1fr grid with a sticky aside; below it the columns
 * stack. The top bar carries the prototype's d-only pair — «Избранное»
 * and «Мой вишлист» — and nothing below 920px. Everything reads the
 * member's synchronised partition (issue #14), so the screen answers the
 * same online and offline (ADR-0002).
 */
export function WishlistsScreen() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const { snapshot, wishes, favorites, reservations, profiles, downloaded } = useWishlistData()
  const meId = getActiveMemberId()

  const mine = meId === undefined ? [] : wishesOf(wishes, meId)
  const mineOpen = openWishesOf(wishes, meId ?? '')
  const mineReceived = mine.length - mineOpen.length
  // The same derivation the favorites screen counts, so the two numbers
  // cannot disagree: absent wishes and received ones are left out.
  const savedIdeas = favoritesWithWishes(favorites, wishes)
  // An archived member's wishlist is hidden from the space (issue #23):
  // the store may still hold their profile, but no card for them.
  const others = profiles.filter(
    (profile) => profile.id !== meId && profile.archivedAt === undefined,
  )
  // The birthdays read the calendar's events from the same partition; a
  // partial calendar (a replay pending) can only leave a note unpainted,
  // never paint one the events do not carry.
  const birthdays = nearBirthdays(snapshot.data?.events ?? [], profiles, new Date())
  const notedBirthday = [...birthdays.values()].reduce<undefined | NearBirthday>(
    (nearest, birthday) =>
      nearest === undefined || birthday.daysUntil < nearest.daysUntil ? birthday : nearest,
    undefined,
  )
  const notedWishes =
    notedBirthday === undefined ? 0 : openWishesOf(wishes, notedBirthday.memberId).length

  return (
    <WishlistShell
      title={t('wishlist.title')}
      desktopActions={
        <>
          <Button size="sm" variant="secondary" render={<Link to="/wishlist/favorites" />}>
            <Icon name="heart" />
            {t('wishlist.favoritesNav')}
          </Button>
          <Button size="sm" render={<Link to="/wishlist/mine" />}>
            {t('wishlist.myWishlist')}
          </Button>
        </>
      }
    >
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : !downloaded ? (
        // A device with nothing downloaded says so for the whole section:
        // counting the own list, or the members it happens to hold, would
        // be a claim the device cannot make (ADR-0014).
        <div className="pt-5">
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="cloud-off" />
              </EmptyMedia>
              <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
              <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
            </Empty>
          </Card>
        </div>
      ) : (
        // The prototype's .diary-grid: the columns stacked below 920px,
        // the 1.6fr / 1fr split with a 32px gap above.
        <div className="flex flex-col gap-3 pt-5 desktop:grid desktop:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] desktop:items-start desktop:gap-8">
          <div className="flex min-w-0 flex-col gap-3">
            <header className="mb-1.5">
              <h1 className="text-display-lg">{t('wishlist.title')}</h1>
              <p className="mt-1 text-body text-muted-foreground">{t('wishlist.subtitle')}</p>
            </header>

            {/* The own list, the prototype's avatar-led link card. */}
            <Link to="/wishlist/mine" className="block">
              <Card variant="list" hoverable>
                <Item size="lg">
                  <Avatar hue={hueFromId(meId ?? '')}>
                    <AvatarFallback>
                      {monogramOf(
                        meId === undefined
                          ? t('wishlist.authorUnknown')
                          : authorName(meId, profiles, t('wishlist.authorUnknown')),
                      )}
                    </AvatarFallback>
                  </Avatar>
                  <ItemContent>
                    <ItemTitle>{t('wishlist.myWishlist')}</ItemTitle>
                    <ItemDescription singleLine>
                      {t('wishlist.openCount', { count: mineOpen.length })}
                      {mineReceived > 0 && (
                        <> · {t('wishlist.receivedCount', { count: mineReceived })}</>
                      )}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Icon name="chevron-right" className="text-muted-foreground" />
                  </ItemActions>
                </Item>
              </Card>
            </Link>

            <SectionHeader
              title={t('wishlist.members')}
              action={
                // The prototype's trailing mono meta, muted like .meta —
                // not the accent link the section header carries elsewhere.
                <span className="font-normal text-meta text-muted-foreground uppercase">
                  {t('wishlist.listsCount', { count: others.length })}
                </span>
              }
            />
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
              <Card variant="list">
                {others.map((profile) => (
                  <MemberWishlistRow
                    key={profile.id}
                    profile={profile}
                    openCount={openWishesOf(wishes, profile.id).length}
                    reservedCount={
                      openWishesOf(wishes, profile.id).filter(
                        (memberWish) => reservationFor(reservations, memberWish.id) !== undefined,
                      ).length
                    }
                    birthday={birthdays.get(profile.id)}
                  />
                ))}
              </Card>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4 desktop:sticky desktop:top-[calc(var(--topbar-h)+24px)]">
            {notedBirthday !== undefined && (
              <BirthdayNote birthday={notedBirthday} openCount={notedWishes} locale={locale} />
            )}

            {/* The surprise rule, the prototype's padded card with the
                18px accent icon. */}
            <Card variant="padded">
              <div className="flex items-center gap-2">
                <Icon name="eye-off" size={18} className="text-primary" />
                <h3>{t('wishlist.surpriseTitle')}</h3>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t('wishlist.surpriseText')}</p>
            </Card>

            {/* The favourites, led by the prototype's bare accent heart. */}
            <Link to="/wishlist/favorites" className="block">
              <Card variant="list" hoverable>
                <Item>
                  <ItemMedia tone="primary">
                    <Icon name="heart" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('wishlist.favoritesRowTitle')}</ItemTitle>
                    <ItemDescription singleLine>
                      {t('wishlist.favoritesCount', { count: savedIdeas.length })} ·{' '}
                      {t('wishlist.favoritesPrivate')}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Icon name="chevron-right" className="text-muted-foreground" />
                  </ItemActions>
                </Item>
              </Card>
            </Link>
          </aside>
        </div>
      )}
    </WishlistShell>
  )
}

/** The aside's birthday note: the event as its creator titled it, the
 *  date, the days left, and the ideas already waiting in the list. */
function BirthdayNote({
  birthday,
  openCount,
  locale,
}: {
  birthday: NearBirthday
  openCount: number
  locale: Locale
}) {
  const { t } = useTranslation()
  const day = parseDateOnly(birthday.dayKey)
  return (
    <NoteBlock icon="cake">
      {day !== undefined && (
        <p>
          {birthday.daysUntil === 0
            ? t('wishlist.birthdayNoteToday', { title: birthday.occurrence.title })
            : t('wishlist.birthdayNote', {
                title: birthday.occurrence.title,
                date: formatDayLong(day, locale),
                count: birthday.daysUntil,
              })}
        </p>
      )}
      <p className={day !== undefined ? 'mt-1' : undefined}>
        {t('wishlist.birthdayNoteIdeas', { count: openCount })}
      </p>
    </NoteBlock>
  )
}

function MemberWishlistRow({
  profile,
  openCount,
  reservedCount,
  birthday,
}: {
  profile: StoredMemberProfile
  openCount: number
  reservedCount: number
  birthday: NearBirthday | undefined
}) {
  const { t } = useTranslation()
  const name = authorName(profile.id, [profile], t('wishlist.authorUnknown'))
  // The near birthday is the urgent story and takes the line; the
  // reserved count is the next one; a quiet list says nothing, like the
  // prototype's Миша row.
  const status =
    birthday === undefined
      ? reservedCount > 0
        ? t('wishlist.reservedCount', { count: reservedCount })
        : undefined
      : birthday.daysUntil === 0
        ? t('wishlist.birthdayToday')
        : t('wishlist.birthdayIn', { count: birthday.daysUntil })
  return (
    <Item size="lg" render={<Link to="/wishlist/$memberId" params={{ memberId: profile.id }} />}>
      <Avatar hue={hueFromId(profile.id)}>
        <AvatarFallback>{monogramOf(name)}</AvatarFallback>
      </Avatar>
      <ItemContent>
        <ItemTitle>
          {name}
          <span className="font-normal text-muted-foreground">
            {' '}
            · {t('wishlist.openCount', { count: openCount })}
          </span>
        </ItemTitle>
        {status !== undefined && <ItemDescription singleLine>{status}</ItemDescription>}
      </ItemContent>
      <ItemActions>
        {birthday !== undefined && <Badge variant="warn">{t('wishlist.birthdaySoonPill')}</Badge>}
        <Icon name="chevron-right" className="text-muted-foreground" />
      </ItemActions>
    </Item>
  )
}
