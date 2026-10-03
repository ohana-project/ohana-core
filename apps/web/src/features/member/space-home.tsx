import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { MemberLayout } from '@/app/layouts/member-layout.tsx'
import { occurrenceLink, upcomingEvents } from '@/features/calendar/calendar-entries.ts'
import { EventTimeLine } from '@/features/calendar/event-time.tsx'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { ALL_SECTIONS_VISIBLE, useNavSections } from '@/features/member/use-nav-sections.ts'
import { useSectionNav } from '@/features/member/use-section-nav.ts'
import { useSyncStatus } from '@/features/member/use-sync-status.ts'
import { sectionDownloaded, useSyncedSpace } from '@/features/member/use-synced-space.ts'
import { useMemberUserMenu } from '@/features/member/use-user-menu.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/ui/item.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'

/*
 * The space home (docs/design/screens/home.html): the greeting with the
 * date meta under it, then the journal and events columns and the members
 * of the space. Everything reads the member's local store (issue #14), so
 * opening Ohana answers from local data — online and offline (ADR-0002).
 * A device with nothing downloaded says so instead of showing empty
 * sections, and the shell's indicator follows the sync engine's status.
 */

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

export function SpaceHomeScreen() {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const snapshot = useSyncedSpace()
  const sync = useSyncStatus()
  const sections = useNavSections()
  const userMenuItems = useMemberUserMenu()
  const onSectionClick = useSectionNav()

  if (session.me === undefined) return null
  const me = session.me
  const displayName = me.member.displayName ?? me.member.name

  const dateLabel = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(new Date())
    .toLocaleUpperCase(i18n.language)

  // A device with nothing downloaded does not pretend the space is empty:
  // it says that nothing is available offline yet (ADR-0002).
  const hasData = snapshot.data?.revision !== undefined
  const visibility = snapshot.data?.space?.sections ?? ALL_SECTIONS_VISIBLE
  // One reading of now for the whole column: the same moments the calendar
  // screen's agenda would name.
  const upcoming = upcomingEvents(snapshot.data?.events ?? [], new Date()).slice(0, 3)

  return (
    <MemberLayout
      space={{
        name: me.space.name,
        marks: [{ initials: monogramOf(displayName), hue: hueFromId(me.member.id) }],
      }}
      sections={sections}
      activeId="home"
      sync={sync}
      userMenuItems={userMenuItems}
      onSectionClick={onSectionClick}
    >
      <div className="flex flex-col gap-6 pt-6">
        <header>
          <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
            {dateLabel}
          </p>
          <h1 className="mt-1 text-display-lg">
            {t(greetings[greetingKey(new Date().getHours())], { name: displayName })}
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
            {visibility.journal && (
              <section>
                <SectionHeader title={t('member.home.journalSection')} />
                <Card>
                  <Empty>
                    <EmptyMedia>
                      <Icon name="book" />
                    </EmptyMedia>
                    <EmptyTitle>{t('member.home.journalEmpty')}</EmptyTitle>
                  </Empty>
                </Card>
              </section>
            )}

            {visibility.calendar && (
              <section>
                <SectionHeader title={t('member.home.eventsSection')} />
                {/* While the calendar is the section a replay promise names,
                    the rows held are a fraction of it — the column says
                    nothing is downloaded rather than showing them
                    (ADR-0014). */}
                {!sectionDownloaded(snapshot.data, 'calendar') ? (
                  <Card>
                    <Empty>
                      <EmptyMedia>
                        <Icon name="cloud-off" />
                      </EmptyMedia>
                      <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
                    </Empty>
                  </Card>
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
                  <Card className="py-0">
                    <ul className="divide-y divide-border">
                      {upcoming.map((event) => (
                        <li key={event.id}>
                          <Link
                            to="/calendar/$eventId"
                            {...occurrenceLink(event)}
                            className="flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-accent"
                          >
                            <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                              <Icon name={event.allDay ? 'sun' : 'clock'} className="size-5" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-sm font-semibold">{event.title}</span>
                              <EventTimeLine
                                event={event}
                                className="truncate text-sm text-muted-foreground"
                              />
                            </span>
                            <Icon name="chevron-right" className="text-muted-foreground" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </section>
            )}

            <section>
              <SectionHeader title={t('member.home.membersSection')} />
              <Card className="py-0">
                <ItemGroup>
                  {snapshot.data?.members
                    .filter((profile) => profile.archivedAt === undefined)
                    .map((profile) => {
                      const profileName = profile.displayName ?? profile.name
                      const contacts = [profile.email, profile.phone].filter(Boolean).join(' · ')
                      return (
                        <Item key={profile.id} size="lg">
                          <Avatar size="sm" hue={hueFromId(profile.id)}>
                            <AvatarFallback>{monogramOf(profileName)}</AvatarFallback>
                          </Avatar>
                          <ItemContent>
                            <ItemTitle>{profileName}</ItemTitle>
                            {contacts.length > 0 ? (
                              <ItemDescription>{contacts}</ItemDescription>
                            ) : null}
                          </ItemContent>
                          <Badge variant={profile.role === 'owner' ? 'primary' : 'neutral'}>
                            {profile.role === 'owner'
                              ? t('admin.space.ownerPill')
                              : t('admin.space.regularPill')}
                          </Badge>
                        </Item>
                      )
                    })}
                </ItemGroup>
              </Card>
            </section>
          </>
        )}
      </div>
    </MemberLayout>
  )
}
