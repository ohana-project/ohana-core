import type { Locale } from '@ohana/i18n'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import {
  type CalendarOccurrence,
  daysUntilOccurrence,
  occurrenceLink,
  SOON_WINDOW_DAYS,
  upcomingEvents,
} from '@/features/calendar/calendar-entries.ts'
import { EventTimeLine } from '@/features/calendar/event-time.tsx'
import { authorName, journalFeed } from '@/features/journal/journal-entries.ts'
import { EntryCard } from '@/features/journal/journal-entry-card.tsx'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useMemberShell } from '@/features/member/use-member-shell.ts'
import { ALL_SECTIONS_VISIBLE } from '@/features/member/use-nav-sections.ts'
import { sectionDownloaded, useSyncedSpace } from '@/features/member/use-synced-space.ts'
import { BirthdayNote } from '@/features/wishlist/birthday-note.tsx'
import {
  type NearBirthday,
  nearBirthdays,
  openWishesOf,
} from '@/features/wishlist/wishlist-entries.ts'
import { Badge } from '@/ui/badge.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The space home (docs/design/screens/home.html, issue #65): the date
 * line and the display-size greeting, then the prototype's two columns —
 * the journal's freshest entry cards on the left, the upcoming events
 * with the birthday note on the right — one column with 28px gaps below
 * 920px, the 1.55fr / 1fr grid with a 40px gap above. Everything reads
 * the member's local store (issue #14), so opening Ohana answers from
 * local data — online and offline (ADR-0002). A device with nothing
 * downloaded says so instead of showing empty sections, and the shell's
 * indicator follows the sync engine's status.
 */

/** The freshest published entries the journal column shows: the
 *  prototype's two cards. */
const RECENT_ENTRY_COUNT = 2

const greetings = {
  morning: 'member.home.greetingMorning',
  afternoon: 'member.home.greetingAfternoon',
  evening: 'member.home.greetingEvening',
} as const

function greetingKey(hour: number): keyof typeof greetings {
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
  return 'evening'
}

/** The nothing-downloaded answer of a column whose section cannot be
 *  claimed: a partition without a cursor has nothing at all, and a
 *  replay promise (ADR-0014) leaves only a fraction of the section. */
function NothingDownloaded() {
  const { t } = useTranslation()
  return (
    <Card>
      <Empty>
        <EmptyMedia>
          <Icon name="cloud-off" />
        </EmptyMedia>
        <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
        <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
      </Empty>
    </Card>
  )
}

export function SpaceHomeScreen() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const session = useMemberSessionStatus()
  const snapshot = useSyncedSpace()
  // The shell's data — the space with the first two members' monograms,
  // the sections, the sync state, the user menu — comes from the one
  // builder every member area shares (issue #62).
  const shell = useMemberShell()

  if (session.me === undefined) return null
  const me = session.me
  const displayName = me.member.displayName ?? me.member.name

  // One reading of now for the whole screen: the date line, the greeting,
  // the events' soon marks and the birthday note all name the same
  // moment.
  const now = new Date()

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(now)
    .toLocaleUpperCase(locale)

  // A device with nothing downloaded does not pretend the space is empty:
  // it says that nothing is available offline yet (ADR-0002).
  const hasData = snapshot.data?.revision !== undefined
  const visibility = snapshot.data?.space?.sections ?? ALL_SECTIONS_VISIBLE
  const profiles = snapshot.data?.members ?? []
  const journalReady = sectionDownloaded(snapshot.data, 'journal')
  const calendarReady = sectionDownloaded(snapshot.data, 'calendar')

  // The journal column: the published entries, newest first (issue #15),
  // cut to the prototype's two freshest cards; a draft is nobody's
  // reading but its author's, and the feed derivation already knows it.
  const recentEntries = journalFeed(snapshot.data?.entries ?? []).slice(0, RECENT_ENTRY_COUNT)

  // The events column: the agenda's window (issue #21), cut to the
  // prototype's three rows.
  const upcoming = upcomingEvents(snapshot.data?.events ?? [], now).slice(0, 3)

  // The birthday note reads the same derivation the wishlists overview's
  // aside paints (issue #66): a calendar event whose title carries a
  // birthday word and begins a member's name, within the month ahead —
  // the reader's own birthday is nobody's errand to run, and an archived
  // member's is no errand at all. The note is an errand over the
  // wishlists, so it waits for that section to exist and be claimable:
  // a link into a hidden section is broken guidance, and while the
  // wishlist's replay is owed the ideas line would count a fraction. A
  // partial calendar, as on the overview, can only leave the note
  // unpainted, never paint one the events do not carry.
  const wishlistClaimable = visibility.wishlist && sectionDownloaded(snapshot.data, 'wishlist')
  const others = profiles.filter(
    (profile) => profile.id !== me.member.id && profile.archivedAt === undefined,
  )
  const birthdays = nearBirthdays(snapshot.data?.events ?? [], others, now)
  const notedBirthday =
    calendarReady && wishlistClaimable
      ? [...birthdays.values()].reduce<undefined | NearBirthday>(
          (nearest, birthday) =>
            nearest === undefined || birthday.daysUntil < nearest.daysUntil ? birthday : nearest,
          undefined,
        )
      : undefined
  const notedWishes =
    notedBirthday === undefined
      ? 0
      : openWishesOf(snapshot.data?.wishes ?? [], notedBirthday.memberId).length

  return (
    <MemberLayout
      space={shell.space}
      // The home's top-bar title is the space name, like the prototype's
      // `data-title` on home.html — not the section label.
      title={shell.space.name}
      sections={shell.sections}
      activeId="home"
      sync={shell.sync}
      userMenuItems={shell.userMenuItems}
      onSpaceClick={shell.onSpaceClick}
      onSectionClick={shell.onSectionClick}
    >
      <div className="flex flex-col pt-6">
        <header>
          <p className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
            {dateLabel}
          </p>
          {/* The prototype's `.display-xl`: the type scale's display size. */}
          <h1 className="mt-1.5 text-display">
            {t(greetings[greetingKey(now.getHours())], { name: displayName })}
          </h1>
        </header>

        {snapshot.isPending ? (
          // The partition read is quick, but it is the honest first state.
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : snapshot.isError ? (
          <ErrorState onRetry={() => void snapshot.refetch()} />
        ) : !hasData ? (
          <div className="mt-6">
            <NothingDownloaded />
          </div>
        ) : (
          // The prototype's `.home-grid`: a 28px column below 920px, the
          // 1.55fr / 1fr grid with a 40px gap from 920px, the journal
          // first.
          <div className="mt-6 flex flex-col gap-7 desktop:grid desktop:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] desktop:items-start desktop:gap-10">
            {visibility.journal && (
              <section
                aria-label={t('member.home.journalSection')}
                className="flex min-w-0 flex-col gap-3"
              >
                <SectionHeader
                  title={t('member.home.journalSection')}
                  action={<Link to="/journal">{t('member.home.journalLink')}</Link>}
                />
                {!journalReady ? (
                  <NothingDownloaded />
                ) : recentEntries.length === 0 ? (
                  <Card>
                    <Empty>
                      <EmptyMedia>
                        <Icon name="book" />
                      </EmptyMedia>
                      <EmptyTitle>{t('member.home.journalEmpty')}</EmptyTitle>
                    </Empty>
                  </Card>
                ) : (
                  recentEntries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      author={authorName(entry.authorId, profiles, t('journal.authorUnknown'))}
                      locale={locale}
                    />
                  ))
                )}
              </section>
            )}

            {visibility.calendar && (
              <section
                aria-label={t('member.home.eventsSection')}
                className="flex min-w-0 flex-col gap-3"
              >
                <SectionHeader
                  title={t('member.home.eventsSection')}
                  action={<Link to="/calendar">{t('member.home.eventsLink')}</Link>}
                />
                {/* While the calendar is the section a replay promise names,
                    the rows held are a fraction of it — the column says
                    nothing is downloaded rather than showing them
                    (ADR-0014). */}
                {!calendarReady ? (
                  <NothingDownloaded />
                ) : upcoming.length === 0 ? (
                  <Card>
                    <Empty>
                      <EmptyMedia>
                        <Icon name="calendar" />
                      </EmptyMedia>
                      <EmptyTitle>{t('member.home.eventsEmpty')}</EmptyTitle>
                    </Empty>
                  </Card>
                ) : (
                  <Card variant="list">
                    <ItemGroup>
                      {upcoming.map((event) => (
                        <HomeEventRow key={event.id} event={event} now={now} />
                      ))}
                    </ItemGroup>
                  </Card>
                )}
                {/* The note rides the events column like the prototype's
                    `.venue-note`, its 10px margin over the column's 12px
                    gap. The birthday derivation above has already held it
                    back while a replay is owed or the wishlists are
                    hidden. */}
                {notedBirthday !== undefined && (
                  <BirthdayNote
                    birthday={notedBirthday}
                    openCount={notedWishes}
                    locale={locale}
                    icon="gift"
                    className="mt-2.5"
                    link={<Link to="/wishlist">{t('member.home.wishlistsLink')}</Link>}
                  />
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </MemberLayout>
  )
}

/** One event row of the home's list (docs/design/screens/home.html): the
 *  list row at its event height (64px), the 38px tile — warn for the
 *  all-day kind, `surface-2` otherwise — the title, the time line, and
 *  the trailing «скоро» pill for an all-day event inside the product's
 *  soon window, the chevron carrying the rest to the event screen. The
 *  same anatomy the calendar's agenda rows keep (issue #73), with the
 *  pill the home's prototype draws. */
function HomeEventRow({ event, now }: { event: CalendarOccurrence; now: Date }) {
  const { t } = useTranslation()
  const days = daysUntilOccurrence(event, now)
  const soon = event.allDay && days !== undefined && days >= 0 && days <= SOON_WINDOW_DAYS
  return (
    <Item size="lg" render={<Link to="/calendar/$eventId" {...occurrenceLink(event)} />}>
      <ItemMedia variant="icon" tone={event.allDay ? 'warn' : 'neutral'}>
        <Icon name={event.allDay ? 'sun' : event.seriesId !== undefined ? 'repeat' : 'clock'} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{event.title}</ItemTitle>
        <ItemDescription>
          <EventTimeLine event={event} />
        </ItemDescription>
      </ItemContent>
      {soon ? (
        <Badge variant="warn">{t('member.home.soonPill')}</Badge>
      ) : (
        <Icon name="chevron-right" className="text-muted-foreground" />
      )}
    </Item>
  )
}
