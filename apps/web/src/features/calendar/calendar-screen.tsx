import type { Locale } from '@ohana/i18n'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type DateOnly,
  formatDateOnly,
  formatDayLong,
  formatDayShort,
  formatMonthName,
  formatMonthTitle,
  type MonthDay,
  monthGrid,
  nextMonth,
  parseDateOnly,
  previousMonth,
  shiftDateKey,
  todayDateOnly,
  zoneLabel,
} from '@/lib/calendar-dates.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Fab } from '@/ui/fab.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { type AgendaGroup, agendaGroups } from './agenda-groups.ts'
import {
  type CalendarOccurrence,
  calendarOccurrences,
  eventDateKey,
  eventsByDate,
  occurrenceLink,
  upcomingEvents,
} from './calendar-entries.ts'
import { CalendarShell } from './calendar-shell.tsx'
import { EventTimeLine } from './event-time.tsx'
import { MonthGrid } from './month-grid.tsx'
import { useCalendarData } from './use-calendar.ts'

/*
 * The calendar (docs/design/screens/calendar.html, issue #73): the month
 * card of square cells with a dot per busy day beside the agenda of what
 * is coming. Both read the member's synchronised partition (issue #20),
 * so the screen answers the same online and offline (ADR-0002); a
 * repeating event (issue #21) joins its occurrences for the window the
 * screen draws, the expansion the device runs itself. A tap on a day
 * with events opens the sheet with that day's list, the prototype's
 * move. The prototype's split — the 1.6fr / 1fr grid with the sticky
 * agenda from 920px — carries the month navigation and the new-event
 * button only on desktop; on a phone the FAB carries the action and the
 * month is the one the device sits in.
 */
export function CalendarScreen() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const { snapshot, events, space, downloaded } = useCalendarData()
  const navigate = useNavigate()

  const today = todayDateOnly()
  const [view, setView] = useState({ year: today.year, month: today.month })
  // The day whose sheet is open: the date itself, not the rows — while the
  // sheet is open a sync may re-deliver the partition, and the sheet reads
  // the rows underneath (use-calendar.ts) without holding stale ones.
  const [openDay, setOpenDay] = useState<DateOnly | undefined>(undefined)

  const grid = monthGrid(view.year, view.month)
  // The grid's own window, the series' frame the expansion walks: every
  // occurrence the drawn weeks hold, cancelled ones skipped (issue #21).
  // The window reaches a day past each drawn bound — a timed occurrence a
  // zone shift lands on the first or last cell is still expanded — and
  // the day buckets keep only what a drawn cell reads.
  const { from: windowFrom, to: windowTo } = gridWindow(grid)
  const byDate = useMemo(
    () =>
      eventsByDate(
        calendarOccurrences(events, shiftDateKey(windowFrom, -1), shiftDateKey(windowTo, 1)),
      ),
    [events, windowFrom, windowTo],
  )
  const upcoming = upcomingEvents(events, new Date())

  return (
    <CalendarShell
      title={t('calendar.title')}
      width="wide"
      desktopActions={
        <Button size="sm" render={<Link to="/calendar/new" />}>
          <Icon name="plus" />
          {t('calendar.newEvent')}
        </Button>
      }
    >
      {/* The prototype's `.cal-head` spans the whole content width — the
          navigation reaches the split's right edge — with the desktop-only
          controls at its tail (a phone shows the month it sits in). */}
      <div className="pt-5">
        <div className="mb-3.5 flex items-center gap-1.5">
          <h1 className="mr-auto font-display text-[22px] leading-[1.2] font-semibold tracking-[-0.015em]">
            {formatMonthTitle(view.year, view.month, locale)}
          </h1>
          <div className="hidden items-center gap-1 desktop:flex">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setView({ year: today.year, month: today.month })}
            >
              {t('calendar.today')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('calendar.previousMonth')}
              onClick={() => setView((current) => previousMonth(current.year, current.month))}
            >
              <Icon name="chevron-left" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('calendar.nextMonth')}
              onClick={() => setView((current) => nextMonth(current.year, current.month))}
            >
              <Icon name="chevron-right" />
            </Button>
          </div>
        </div>

        {/* The prototype's `.cal-split`: a 28px column below 920px, the
            1.6fr / 1fr grid with a 36px gap and the sticky agenda above. */}
        <div className="flex flex-col gap-7 desktop:grid desktop:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] desktop:items-start desktop:gap-9">
          <section aria-label={t('calendar.monthView')} className="min-w-0">
            {snapshot.isPending ? (
              <div className="grid place-items-center py-10">
                <Spinner className="size-6" />
              </div>
            ) : !downloaded ? (
              // A device with nothing downloaded says so for the whole
              // section: drawing a month of dots from a fraction of the
              // calendar would be a claim the device cannot make (ADR-0014).
              // The empty state stands bare (README "Cards") — no card around it.
              <Empty>
                <EmptyMedia>
                  <Icon name="cloud-off" />
                </EmptyMedia>
                <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
                <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
              </Empty>
            ) : (
              <>
                {/* The prototype's `.cal-card`: 16px all around. */}
                <Card size="sm" variant="padded">
                  <MonthGrid
                    grid={grid}
                    byDate={byDate}
                    today={today}
                    locale={locale}
                    onOpenDay={setOpenDay}
                  />
                </Card>
                <p className="mt-3 px-1 text-meta text-muted-foreground">
                  {t('calendar.spaceZone', { zone: zoneLabel(space?.timezone ?? 'UTC') })}
                </p>
              </>
            )}
          </section>

          <aside
            aria-label={t('calendar.agenda')}
            className="min-w-0 desktop:sticky desktop:top-[calc(var(--topbar-h)+24px)]"
          >
            {snapshot.isPending || !downloaded ? null : (
              <div className="flex flex-col">
                {agendaGroups(upcoming, today).map((group) => {
                  const key =
                    group.kind === 'month'
                      ? `${group.date.year}-${group.date.month}`
                      : formatDateOnly(group.date)
                  return (
                    <section key={key} className="mt-[22px] first:mt-0">
                      <p className="mb-2.5 flex items-center gap-3 font-mono text-[12px] tracking-[0.08em] text-muted-foreground uppercase">
                        {agendaLabelText(group, t, locale)}
                        <span aria-hidden="true" className="flex-1 border-t border-border" />
                      </p>
                      <Card variant="list">
                        <ItemGroup>
                          {group.events.length === 0 ? (
                            // The prototype's muted row for an empty «Сегодня».
                            <Item>
                              <ItemContent>
                                <ItemDescription>{t('calendar.agendaNoEvents')}</ItemDescription>
                              </ItemContent>
                            </Item>
                          ) : (
                            group.events.map((event) => (
                              <EventRow
                                key={event.id}
                                event={event}
                                locale={locale}
                                withDate={group.kind === 'month'}
                              />
                            ))
                          )}
                        </ItemGroup>
                      </Card>
                    </section>
                  )
                })}
              </div>
            )}
          </aside>
        </div>
      </div>

      <Fab
        icon="plus"
        aria-label={t('calendar.newEvent')}
        onClick={() => void navigate({ to: '/calendar/new' })}
      />

      {openDay !== undefined && (
        <DaySheet
          day={openDay}
          dayEvents={byDate.get(formatDateOnly(openDay)) ?? []}
          today={today}
          locale={locale}
          onClose={() => setOpenDay(undefined)}
        />
      )}
    </CalendarShell>
  )
}

/** The group's heading: «Сегодня · 28 сентября», «Завтра · 29 сентября»,
 *  or the month's name alone, the prototype's labels. */
function agendaLabelText(
  group: AgendaGroup,
  t: (key: 'calendar.agendaToday' | 'calendar.agendaTomorrow', values: { day: string }) => string,
  locale: Locale,
): string {
  const day = formatDayLong(group.date, locale)
  if (group.kind === 'today') return t('calendar.agendaToday', { day })
  if (group.kind === 'tomorrow') return t('calendar.agendaTomorrow', { day })
  return formatMonthName(group.date.year, group.date.month, locale)
}

/** One event row, the list row the agenda and the day sheet share: the
 *  38px leading tile — warn for the all-day kind, surface-2 otherwise —,
 *  the title, the time line, the trailing chevron; 64px, the prototype's
 *  `.list-row` at its event height. A month group's row leads with its
 *  day («сб, 3 октября · …»), the prototype's dated subtitles; today's
 *  and tomorrow's rows carry no date — the group label names it — and
 *  the day sheet names it in its title. */
function EventRow({
  event,
  locale,
  dimmed = false,
  withDate = false,
  onClick,
}: {
  event: CalendarOccurrence
  locale: Locale
  dimmed?: boolean
  withDate?: boolean
  onClick?: () => void
}) {
  const { t } = useTranslation()
  const day = withDate ? orDate(event) : undefined
  return (
    <Item
      size="lg"
      render={<Link to="/calendar/$eventId" {...occurrenceLink(event)} onClick={onClick} />}
      className={dimmed ? 'opacity-[0.62]' : undefined}
    >
      <ItemMedia variant="icon" tone={event.allDay ? 'warn' : 'neutral'}>
        <Icon name={event.allDay ? 'sun' : event.seriesId !== undefined ? 'repeat' : 'clock'} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{event.title}</ItemTitle>
        <ItemDescription>
          {day !== undefined && `${formatDayShort(day, locale)} · `}
          {event.allDay ? t('calendar.allDayShort') : <EventTimeLine event={event} />}
        </ItemDescription>
      </ItemContent>
      <Icon name="chevron-right" className="text-muted-foreground" />
    </Item>
  )
}

/** The event's device-local day, parsed for a label; undefined when the
 *  row names no day (the agenda's buckets always do). */
function orDate(event: CalendarOccurrence): DateOnly | undefined {
  const key = eventDateKey(event)
  return key === undefined ? undefined : parseDateOnly(key)
}

/** The drawn weeks' bounds, the wall-date window the occurrences expand
 *  over (issue #21). The grid always draws six weeks; an empty one —
 *  nothing the renderer could draw anyway — answers an empty window. */
function gridWindow(grid: MonthDay[]): { from: string; to: string } {
  const first = grid.at(0)?.date
  const last = grid.at(-1)?.date
  if (first === undefined || last === undefined) return { from: '0000-01-01', to: '0000-01-01' }
  return { from: formatDateOnly(first), to: formatDateOnly(last) }
}

function DaySheet({
  day,
  dayEvents,
  today,
  locale,
  onClose,
}: {
  day: DateOnly
  dayEvents: CalendarOccurrence[]
  today: DateOnly
  locale: Locale
  onClose: () => void
}) {
  const { t } = useTranslation()
  // A past day's rows dim, the prototype's `opacity: .62`.
  const past = formatDateOnly(day) < formatDateOnly(today)
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{formatDayLong(day, locale)}</SheetTitle>
          <SheetDescription>{t('calendar.dayCount', { count: dayEvents.length })}</SheetDescription>
        </SheetHeader>
        {/* the sheet scrolls as a whole (issue #59), so the list needs
            no scroll area of its own */}
        <Card variant="list">
          <ItemGroup>
            {dayEvents.length === 0 ? (
              // The sheet only opens for a day with events; a sync that
              // empties it while open still says so.
              <Item>
                <ItemContent>
                  <ItemDescription>{t('calendar.dayEmpty')}</ItemDescription>
                </ItemContent>
              </Item>
            ) : (
              dayEvents.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  locale={locale}
                  dimmed={past}
                  onClick={onClose}
                />
              ))
            )}
          </ItemGroup>
        </Card>
      </SheetContent>
    </Sheet>
  )
}
