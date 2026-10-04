import type { Locale } from '@ohana/i18n'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type DateOnly,
  formatDateOnly,
  formatDayLong,
  formatMonthTitle,
  type MonthDay,
  monthGrid,
  nextMonth,
  previousMonth,
  shiftDateKey,
  todayDateOnly,
  weekdayHeaders,
  zoneLabel,
} from '@/lib/calendar-dates.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Fab } from '@/ui/fab.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet.tsx'
import { Spinner } from '@/ui/spinner.tsx'
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
import { useCalendarData } from './use-calendar.ts'

/*
 * The calendar (docs/design/screens/calendar.html): the month grid with a
 * dot per busy day beside the agenda of what is coming. Both read the
 * member's synchronised partition (issue #20), so the screen answers the
 * same online and offline (ADR-0002); a repeating event (issue #21) joins
 * its occurrences for the window the screen draws, the expansion the
 * device runs itself. A tap on a day opens the sheet with that day's
 * events, the prototype's move.
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
      actions={
        <Button size="sm" render={<Link to="/calendar/new" />}>
          <Icon name="plus" />
          {t('calendar.newEvent')}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 pt-6 pb-24 lg:flex-row lg:items-start lg:gap-8">
        <section aria-label={t('calendar.monthView')} className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <h1 className="text-[22px] leading-tight font-semibold">
              {formatMonthTitle(view.year, view.month, locale)}
            </h1>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setView({ year: today.year, month: today.month })}
              >
                {t('calendar.today')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('calendar.previousMonth')}
                onClick={() => setView((current) => previousMonth(current.year, current.month))}
              >
                <Icon name="chevron-left" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('calendar.nextMonth')}
                onClick={() => setView((current) => nextMonth(current.year, current.month))}
              >
                <Icon name="chevron-right" />
              </Button>
            </div>
          </div>

          {snapshot.isPending ? (
            <div className="grid place-items-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : !downloaded ? (
            // A device with nothing downloaded says so for the whole
            // section: drawing a month of dots from a fraction of the
            // calendar would be a claim the device cannot make (ADR-0014).
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
            <Card className="py-4">
              <div className="grid grid-cols-7 gap-y-1 px-2 pb-1 text-center font-mono text-meta tracking-wide text-muted-foreground uppercase">
                {weekdayHeaders(locale).map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-y-1 px-2">
                {grid.map(({ date, inMonth }) => {
                  const key = formatDateOnly(date)
                  const dayEvents = byDate.get(key) ?? []
                  const isToday =
                    date.year === today.year && date.month === today.month && date.day === today.day
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOpenDay(date)}
                      aria-label={t('calendar.dayWithEvents', {
                        count: dayEvents.length,
                        day: formatDayLong(date, locale),
                      })}
                      className={[
                        'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md py-1 transition-colors',
                        inMonth ? 'text-foreground' : 'text-muted-foreground/60',
                        // The today tint is the soft accent (primary-soft):
                        // `accent-soft` is not a Tailwind colour at all, so
                        // the class used to compile to nothing (issue #57).
                        isToday ? 'bg-primary-soft font-semibold' : 'hover:bg-accent',
                      ].join(' ')}
                    >
                      <span className="text-body">{date.day}</span>
                      <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                        {dayEvents.slice(0, 3).map((event) => (
                          <i
                            key={event.id}
                            className={[
                              'size-1.5 rounded-full',
                              event.allDay ? 'bg-primary' : 'bg-foreground/45',
                            ].join(' ')}
                          />
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="px-5 pt-3 font-mono text-meta tracking-wide text-muted-foreground">
                {t('calendar.spaceZone', { zone: zoneLabel(space?.timezone ?? 'UTC') })}
              </p>
            </Card>
          )}
        </section>

        <aside aria-label={t('calendar.agenda')} className="w-full lg:w-[380px] lg:shrink-0">
          {snapshot.isPending || !downloaded ? null : upcoming.length === 0 ? (
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="calendar" />
                </EmptyMedia>
                <EmptyTitle>{t('calendar.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('calendar.emptyText')}</EmptyDescription>
              </Empty>
            </Card>
          ) : (
            <div className="flex flex-col gap-4">
              {agendaGroups(upcoming).map(([key, groupEvents]) => (
                <div key={key} className="flex flex-col gap-2">
                  <p className="px-1 font-mono text-meta tracking-wide text-muted-foreground uppercase">
                    {t(agendaLabelKey(key, today), { day: formatDayLong(parseKey(key), locale) })}
                  </p>
                  <Card className="py-0">
                    <ul className="divide-y divide-border">
                      {groupEvents.map((event) => (
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
                </div>
              ))}
            </div>
          )}
        </aside>
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
          locale={locale}
          onClose={() => setOpenDay(undefined)}
        />
      )}
    </CalendarShell>
  )
}

/** The agenda's groups in order, keyed by the device-local day. */
function agendaGroups(upcoming: CalendarOccurrence[]): Array<[string, CalendarOccurrence[]]> {
  const groups = new Map<string, CalendarOccurrence[]>()
  for (const event of upcoming) {
    const key = eventDateKey(event)
    if (key === undefined) continue
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [event])
    else group.push(event)
  }
  return [...groups]
}

/** The group's heading: today, tomorrow, or the day itself. */
function agendaLabelKey(
  key: string,
  today: DateOnly,
): 'calendar.today' | 'calendar.tomorrow' | 'calendar.dayTitle' {
  const tomorrow = new Date(today.year, today.month - 1, today.day + 1)
  const tomorrowKey = formatDateOnly({
    year: tomorrow.getFullYear(),
    month: tomorrow.getMonth() + 1,
    day: tomorrow.getDate(),
  })
  const todayKey = formatDateOnly(today)
  if (key === todayKey) return 'calendar.today'
  if (key === tomorrowKey) return 'calendar.tomorrow'
  return 'calendar.dayTitle'
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

function parseKey(key: string): DateOnly {
  return {
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    day: Number(key.slice(8, 10)),
  }
}

function DaySheet({
  day,
  dayEvents,
  locale,
  onClose,
}: {
  day: DateOnly
  dayEvents: CalendarOccurrence[]
  locale: Locale
  onClose: () => void
}) {
  const { t } = useTranslation()
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{formatDayLong(day, locale)}</SheetTitle>
          <SheetDescription>{t('calendar.dayCount', { count: dayEvents.length })}</SheetDescription>
        </SheetHeader>
        {/* the sheet scrolls as a whole (issue #59), so the list needs
            no scroll area of its own */}
        <div className="flex flex-col gap-1">
          {dayEvents.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">{t('calendar.dayEmpty')}</p>
          ) : (
            dayEvents.map((event) => (
              <Link
                key={event.id}
                to="/calendar/$eventId"
                {...occurrenceLink(event)}
                className="flex min-h-16 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
                onClick={onClose}
              >
                <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                  <Icon name={event.allDay ? 'sun' : 'clock'} className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{event.title}</span>
                  <EventTimeLine event={event} className="truncate text-sm text-muted-foreground" />
                </span>
                <Icon name="chevron-right" className="text-muted-foreground" />
              </Link>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
