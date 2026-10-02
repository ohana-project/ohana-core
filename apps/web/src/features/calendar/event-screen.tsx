import type { Locale } from '@ohana/i18n'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredCalendarEvent, StoredMemberProfile } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { authorName } from '@/features/wishlist/wishlist-entries.ts'
import {
  formatDateOnly,
  formatDayFull,
  formatDayOfYear,
  localDateKey,
  parseDateOnly,
  todayDateOnly,
} from '@/lib/calendar-dates.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { canEditEvent } from './calendar-entries.ts'
import { CalendarShell } from './calendar-shell.tsx'
import { eventDuration, eventTimeParts } from './event-time.tsx'
import {
  isRecurring,
  nextLiveOccurrenceDate,
  occurrenceOf,
  type Recurrence,
  seriesTodayKey,
} from './recurrence.ts'
import {
  calendarErrorMessage,
  useCalendarData,
  useCancelOccurrence,
  useDeleteEvent,
} from './use-calendar.ts'

/*
 * The event screen (docs/design/screens/event.html): one event whole — its
 * device-local time with the zone the event keeps, its length, who created
 * it. For a repeating event (issue #21) the screen shows one occurrence at
 * a time: the link the calendar's lists carry names its original date, and
 * without one the series' next live occurrence stands in. The edit and the
 * delete belong to the event's creator and the owners (issue #20, the
 * journal's moderation model); on a series they ask what to change — this
 * occurrence, or the whole series ("this and following" is not offered, by
 * the ticket's design). The rows come from the synchronised partition, so
 * the screen answers offline like the month (ADR-0002).
 */
export function EventScreen({
  eventId,
  occurrenceDate,
}: {
  eventId: string
  occurrenceDate?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const navigate = useNavigate()
  const { snapshot, events, profiles, downloaded } = useCalendarData()
  const removeEvent = useDeleteEvent()
  const cancelOccurrence = useCancelOccurrence()
  const [confirming, setConfirming] = useState(false)
  const [choosingEdit, setChoosingEdit] = useState(false)
  const [choosingDelete, setChoosingDelete] = useState(false)

  const event = snapshot.isPending ? undefined : eventOf(events, eventId)
  const editable = event !== undefined && canEditEvent(event, getActiveMemberId(), profiles)
  const recurring = event !== undefined && isRecurring(event)
  // The today the anchor's search starts from: the series' own frame —
  // the zone a timed event keeps, the zoneless calendar for an all-day
  // one — so an occurrence still ahead there is not jumped over because
  // the device has rolled past it.
  const todayKey = useMemo(
    () =>
      event === undefined ? formatDateOnly(todayDateOnly()) : seriesTodayKey(event, new Date()),
    [event],
  )
  // The date the occurrence actions act on: the one the link named, or —
  // a series opened without a date, as after its creation — the series'
  // next live occurrence, so a cancelled first date neither dead-ends the
  // screen nor passes itself off as an ordinary event (issue #21). The
  // search costs an expansion, so it runs once per row, not per render.
  const anchorDate = useMemo(
    () =>
      occurrenceDate ??
      (recurring && event !== undefined ? nextLiveOccurrenceDate(event, todayKey) : undefined),
    [occurrenceDate, recurring, event, todayKey],
  )
  const occurrence =
    event !== undefined && anchorDate !== undefined ? occurrenceOf(event, anchorDate) : undefined
  // What the screen shows: the occurrence the anchor names — its effective
  // fields, an override's included — or the series' own row.
  const shown: StoredCalendarEvent | undefined =
    occurrence?.event ?? (occurrenceDate === undefined ? event : undefined)
  // "Cancelled" is the answer only to a link that named its date: on the
  // default landing the anchor is a live occurrence when the series has
  // one, and when it has none the series row stands in with series
  // actions only — a first occurrence's cancellation must not dead-end
  // the screen the series edits return to (issue #21).
  const cancelledHere =
    event !== undefined &&
    occurrenceDate !== undefined &&
    occurrence === undefined &&
    (event.exceptions?.some(
      (candidate) => candidate.originalDate === anchorDate && candidate.kind === 'cancelled',
    ) ??
      false)
  // The occurrence-scoped choices exist when the anchor names a live
  // occurrence; a series with none live ahead still offers its series
  // actions on the landing.
  const hasOccurrence = occurrence !== undefined

  const backToCalendar = () => void navigate({ to: '/calendar' })

  const onDeleteSeries = () => {
    removeEvent.mutate(
      { eventId },
      {
        onSuccess: () => {
          toast(t('calendar.deletedToast'))
          backToCalendar()
        },
        onError: (error) => toast(calendarErrorMessage(error, t), 'danger'),
      },
    )
  }

  const onCancelOccurrence = () => {
    if (anchorDate === undefined) return
    cancelOccurrence.mutate(
      { eventId, originalDate: anchorDate },
      {
        onSuccess: () => {
          toast(t('calendar.occurrenceCancelledToast'))
          backToCalendar()
        },
        onError: (error) => toast(calendarErrorMessage(error, t), 'danger'),
      },
    )
  }

  return (
    <CalendarShell title={t('calendar.eventTitle')} backTo="/calendar" width="narrow">
      <div className="flex flex-col gap-5 pt-6 pb-32">
        {snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : event === undefined ? (
          !downloaded ? (
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
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="calendar" />
                </EmptyMedia>
                <EmptyTitle>{t('calendar.errors.event_not_found')}</EmptyTitle>
              </Empty>
            </Card>
          )
        ) : cancelledHere ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="calendar" />
              </EmptyMedia>
              <EmptyTitle>{t('calendar.occurrenceCancelledTitle')}</EmptyTitle>
              <EmptyDescription>{t('calendar.occurrenceCancelledText')}</EmptyDescription>
            </Empty>
          </Card>
        ) : shown === undefined ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="calendar" />
              </EmptyMedia>
              <EmptyTitle>{t('calendar.errors.occurrence_not_found')}</EmptyTitle>
            </Empty>
          </Card>
        ) : (
          <EventDetails
            event={shown}
            recurrence={event.recurrence}
            profiles={profiles}
            editable={editable}
            recurring={recurring}
            locale={locale}
            onAskEdit={() => setChoosingEdit(true)}
            onAskDelete={() => (recurring ? setChoosingDelete(true) : setConfirming(true))}
          />
        )}
      </div>

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('calendar.deleteConfirmTitle', { title: event?.title ?? '' })}
            </DialogTitle>
            <DialogDescription>{t('calendar.deleteConfirmText')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('calendar.cancel')}
            </Button>
            <Button variant="destructive" disabled={removeEvent.isPending} onClick={onDeleteSeries}>
              {removeEvent.isPending ? <Spinner className="size-4" /> : <Icon name="trash" />}
              {t('calendar.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The scope choices (issue #21): change this occurrence or the whole
          series — one dialog each for the edit and the delete. The
          occurrence choice only where the anchor names a live occurrence. */}
      <ScopeDialog
        open={choosingEdit}
        onClose={() => setChoosingEdit(false)}
        title={t('calendar.editScopeTitle')}
        occurrenceLabel={t('calendar.editScopeOccurrence')}
        seriesLabel={t('calendar.editScopeSeries')}
        showOccurrence={hasOccurrence}
        onOccurrence={() => {
          setChoosingEdit(false)
          void navigate({
            to: '/calendar/$eventId/edit',
            params: { eventId },
            search: anchorDate === undefined ? {} : { date: anchorDate },
          })
        }}
        onSeries={() => {
          setChoosingEdit(false)
          void navigate({ to: '/calendar/$eventId/edit', params: { eventId } })
        }}
      />
      <ScopeDialog
        open={choosingDelete}
        onClose={() => setChoosingDelete(false)}
        title={t('calendar.deleteScopeTitle')}
        occurrenceLabel={t('calendar.deleteScopeOccurrence')}
        seriesLabel={t('calendar.deleteScopeSeries')}
        showOccurrence={hasOccurrence}
        onOccurrence={() => {
          setChoosingDelete(false)
          onCancelOccurrence()
        }}
        onSeries={() => {
          setChoosingDelete(false)
          onDeleteSeries()
        }}
      />
    </CalendarShell>
  )
}

function ScopeDialog({
  open,
  onClose,
  title,
  occurrenceLabel,
  seriesLabel,
  showOccurrence,
  onOccurrence,
  onSeries,
}: {
  open: boolean
  onClose: () => void
  title: string
  occurrenceLabel: string
  seriesLabel: string
  showOccurrence: boolean
  onOccurrence: () => void
  onSeries: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {showOccurrence && (
            <Button variant="secondary" className="justify-start" onClick={onOccurrence}>
              <Icon name="clock" />
              {occurrenceLabel}
            </Button>
          )}
          <Button variant="secondary" className="justify-start" onClick={onSeries}>
            <Icon name="repeat" />
            {seriesLabel}
          </Button>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('calendar.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function eventOf(events: StoredCalendarEvent[], eventId: string): StoredCalendarEvent | undefined {
  return events.find((event) => event.id === eventId)
}

/** The event whole: the date line, the title, the time and zone, the
 *  length, the series it keeps, the creator — and the edit and delete of
 *  its moderator set. */
function EventDetails({
  event,
  recurrence,
  profiles,
  editable,
  recurring,
  locale,
  onAskEdit,
  onAskDelete,
}: {
  event: StoredCalendarEvent
  recurrence: Recurrence | undefined
  profiles: StoredMemberProfile[]
  editable: boolean
  recurring: boolean
  locale: Locale
  onAskEdit: () => void
  onAskDelete: () => void
}) {
  const { t } = useTranslation()
  const time = eventTimeParts(event, t, locale)
  const duration = eventDuration(event, t)
  return (
    <>
      <header className="flex flex-col gap-1 px-1">
        <p className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
          {eventDateLine(event, locale)}
        </p>
        <h1 className="text-display">{event.title}</h1>
        <p className="text-sm text-muted-foreground">{time.primary}</p>
      </header>

      <Card className="py-0">
        <ul className="divide-y divide-border">
          <li className="flex min-h-16 items-center gap-3 px-5 py-3">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
              <Icon name={event.allDay ? 'sun' : 'clock'} className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">{time.primary}</span>
              {time.secondary !== undefined && (
                <span className="text-sm text-muted-foreground">{time.secondary}</span>
              )}
            </span>
          </li>
          {duration !== undefined && (
            <li className="flex min-h-16 items-center gap-3 px-5 py-3">
              <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                <Icon name="clock" className="size-5" />
              </span>
              <span className="text-sm font-semibold">{duration}</span>
              <span className="text-sm text-muted-foreground">{t('calendar.durationLabel')}</span>
            </li>
          )}
          {recurring && recurrence !== undefined && (
            <li className="flex min-h-16 items-center gap-3 px-5 py-3">
              <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
                <Icon name="repeat" className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">
                  {t(repeatLabelKey(recurrence.frequency))}
                </span>
                {recurrence.until !== undefined && (
                  <span className="text-sm text-muted-foreground">
                    {t('calendar.repeatUntilLine', {
                      // The year is part of the bound: a series ends in its
                      // year, and «до 31 января» alone could be any of them.
                      date: formatDayOfYear(
                        parseDateOnly(recurrence.until) ?? { year: 0, month: 1, day: 1 },
                        locale,
                      ),
                    })}
                  </span>
                )}
              </span>
            </li>
          )}
          <li className="flex min-h-16 items-center gap-3 px-5 py-3">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
              <Icon name="user" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-semibold">
                {authorName(event.creatorId, profiles, t('calendar.creatorUnknown'))}
              </span>
              <span className="text-sm text-muted-foreground">
                {t('calendar.createdBy', {
                  date: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(
                    new Date(event.createdAt),
                  ),
                })}
              </span>
            </span>
          </li>
        </ul>
      </Card>

      {editable && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {recurring ? (
            // A series asks what the edit is for: this occurrence, or the
            // whole series (issue #21). A one-time event goes straight to
            // its editor.
            <Button variant="secondary" onClick={onAskEdit}>
              <Icon name="edit" />
              {t('calendar.edit')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              render={<Link to="/calendar/$eventId/edit" params={{ eventId: event.id }} />}
            >
              <Icon name="edit" />
              {t('calendar.edit')}
            </Button>
          )}
          <Button variant="ghost" onClick={onAskDelete}>
            <Icon name="trash" />
            {t('calendar.delete')}
          </Button>
        </div>
      )}
    </>
  )
}

/** «Каждый день» … — the label a series keeps on the screens. */
export function repeatLabelKey(frequency: Recurrence['frequency']) {
  switch (frequency) {
    case 'daily':
      return 'calendar.repeatDaily' as const
    case 'weekly':
      return 'calendar.repeatWeekly' as const
    case 'monthly':
      return 'calendar.repeatMonthly' as const
    case 'yearly':
      return 'calendar.repeatYearly' as const
  }
}

function eventDateLine(event: StoredCalendarEvent, locale: Locale): string {
  const dateKey = event.allDay ? event.date : undefined
  const fallback = event.startsAt === undefined ? undefined : localDateKey(event.startsAt)
  const key = dateKey ?? fallback
  if (key === undefined) return ''
  const parts = parseDateOnly(key)
  return parts === undefined ? '' : formatDayFull(parts, locale)
}
