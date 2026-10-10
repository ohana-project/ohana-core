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
  zonedDateKey,
} from '@/lib/calendar-dates.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { ActionBar } from '@/ui/action-bar.tsx'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { AvatarStack } from '@/ui/avatar-stack.tsx'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { canEditEvent } from './calendar-entries.ts'
import { CalendarShell } from './calendar-shell.tsx'
import {
  eventDuration,
  eventTimeParts,
  reminderFireLine,
  reminderLeadLabel,
  reminderRecipients,
} from './event-time.tsx'
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
 * The event screen (docs/design/screens/event.html): the title with the
 * date above it and the time and zone line under it, one list card with
 * bare-icon rows — time and duration in one row, the series' rule, the
 * reminder and its recipients with their monogram stack —, the created-by
 * mono line under the card, and the recurring explainer. The place and
 * note rows of the prototype have no fields in the event contract, so
 * they have no rows here. For a repeating event (issue #21) the screen
 * shows one occurrence at a time: the link the calendar's lists carry
 * names its original date, and without one the series' next live
 * occurrence stands in. Edit and delete belong to the event's creator
 * and the owners (issue #20, the journal's moderation model): the small
 * edit and the overflow menu in the top bar on desktop, the shared
 * action bar on a phone (issue #61). On a series both ask what to touch —
 * this occurrence, or the whole series ("this and following" is not
 * offered, by the ticket's design). The rows come from the synchronised
 * partition, so the screen answers offline like the month (ADR-0002).
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
  const { snapshot, events, profiles, space, downloaded } = useCalendarData()
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
  // The actions exist where there is something to act on and the actor
  // may: a whole event's screen. The states above it — the wait, the
  // missing row, the cancelled occurrence — carry no actions.
  const canAct = editable && shown !== undefined && !cancelledHere

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

  const onAskEdit = () => setChoosingEdit(true)
  const onAskDelete = () => (recurring ? setChoosingDelete(true) : setConfirming(true))
  // The rule the scope dialog's description names, in its mid-sentence
  // shape: «повторяется каждую неделю». The dialog only opens on a series.
  const scopeRule =
    recurring && event !== undefined
      ? repeatLabel(event.recurrence?.frequency ?? 'weekly', t).toLowerCase()
      : ''

  return (
    <CalendarShell
      title={t('calendar.eventTitle')}
      backTo="/calendar"
      width="narrow"
      desktopActions={
        canAct && event !== undefined ? (
          <EventActions
            placed="desktop"
            eventId={event.id}
            recurring={recurring}
            pending={removeEvent.isPending || cancelOccurrence.isPending}
            onAskEdit={onAskEdit}
            onAskDelete={onAskDelete}
          />
        ) : undefined
      }
    >
      <div className="flex flex-col pt-5">
        {snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : event === undefined ? (
          !downloaded ? (
            // The empty state stands bare (README "Cards") — no card around it.
            <Empty>
              <EmptyMedia>
                <Icon name="cloud-off" />
              </EmptyMedia>
              <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
              <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
            </Empty>
          ) : (
            <Empty>
              <EmptyMedia>
                <Icon name="calendar" />
              </EmptyMedia>
              <EmptyTitle>{t('calendar.errors.event_not_found')}</EmptyTitle>
            </Empty>
          )
        ) : cancelledHere ? (
          <Empty>
            <EmptyMedia>
              <Icon name="calendar" />
            </EmptyMedia>
            <EmptyTitle>{t('calendar.occurrenceCancelledTitle')}</EmptyTitle>
            <EmptyDescription>{t('calendar.occurrenceCancelledText')}</EmptyDescription>
          </Empty>
        ) : shown === undefined ? (
          <Empty>
            <EmptyMedia>
              <Icon name="calendar" />
            </EmptyMedia>
            <EmptyTitle>{t('calendar.errors.occurrence_not_found')}</EmptyTitle>
          </Empty>
        ) : (
          <EventDetails
            event={shown}
            series={event}
            recurrence={event.recurrence}
            profiles={profiles}
            spaceZone={space?.timezone ?? 'UTC'}
            recurring={recurring}
            locale={locale}
          />
        )}
      </div>

      {/* The phone's action bar (issue #61): the same actions the top bar
          carries from 920px up. */}
      {canAct && event !== undefined && (
        <ActionBar>
          <EventActions
            placed="bar"
            eventId={event.id}
            recurring={recurring}
            pending={removeEvent.isPending || cancelOccurrence.isPending}
            onAskEdit={onAskEdit}
            onAskDelete={onAskDelete}
          />
        </ActionBar>
      )}

      <Dialog open={confirming} onOpenChange={(open) => !open && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('calendar.deleteConfirmTitle', { title: event?.title ?? '' })}
            </DialogTitle>
            <DialogDescription>{t('calendar.deleteConfirmText')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('ui.cancel')}
            </Button>
            <Button variant="destructive" disabled={removeEvent.isPending} onClick={onDeleteSeries}>
              {removeEvent.isPending ? <Spinner /> : <Icon name="trash" />}
              {t('calendar.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The scope choices (issue #21), the prototype's series dialog: the
          title and the description naming the event and its rule, then
          three stacked full-width choices — this occurrence, the whole
          series (the primary for the edit, the danger for the delete), and
          the ghost cancel. The occurrence choice only where the anchor
          names a live occurrence. */}
      <ScopeDialog
        open={choosingEdit}
        onClose={() => setChoosingEdit(false)}
        kind="edit"
        title={t('calendar.editScopeTitle')}
        eventTitle={event?.title ?? ''}
        rule={scopeRule}
        showOccurrence={hasOccurrence}
        pending={removeEvent.isPending || cancelOccurrence.isPending}
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
        kind="delete"
        title={t('calendar.deleteScopeTitle')}
        eventTitle={event?.title ?? ''}
        rule={scopeRule}
        showOccurrence={hasOccurrence}
        pending={removeEvent.isPending || cancelOccurrence.isPending}
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

/**
 * The edit and the delete where the prototype puts them: the small
 * primary edit beside the overflow menu in the top bar on desktop, the
 * bar's primary and danger pair on a phone. A series asks what the edit
 * is for; a one-time event goes straight to its editor.
 */
function EventActions({
  placed,
  eventId,
  recurring,
  pending,
  onAskEdit,
  onAskDelete,
}: {
  placed: 'desktop' | 'bar'
  eventId: string
  recurring: boolean
  pending: boolean
  onAskEdit: () => void
  onAskDelete: () => void
}) {
  const { t } = useTranslation()
  // The prototype's shapes: `.btn.btn-primary.btn-sm` in the top bar, the
  // grown primary and the danger in the bar (`.editor-bar`).
  const editProps = {
    ...(placed === 'desktop' ? { size: 'sm' as const } : { className: 'min-w-0 flex-1' }),
  }
  const edit = recurring ? (
    <Button {...editProps} onClick={onAskEdit}>
      <Icon name="edit" />
      {t('calendar.edit')}
    </Button>
  ) : (
    <Button {...editProps} render={<Link to="/calendar/$eventId/edit" params={{ eventId }} />}>
      <Icon name="edit" />
      {t('calendar.edit')}
    </Button>
  )

  if (placed === 'desktop') {
    return (
      <>
        {edit}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon-sm" aria-label={t('ui.more')} />}
          >
            <Icon name="more-h" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" disabled={pending} onClick={onAskDelete}>
              <Icon name="trash" />
              {t('calendar.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>
    )
  }
  return (
    <>
      {edit}
      <Button variant="destructive" disabled={pending} onClick={onAskDelete}>
        <Icon name="trash" />
        {t('calendar.delete')}
      </Button>
    </>
  )
}

function ScopeDialog({
  open,
  onClose,
  kind,
  title,
  eventTitle,
  rule,
  showOccurrence,
  pending,
  onOccurrence,
  onSeries,
}: {
  open: boolean
  onClose: () => void
  kind: 'edit' | 'delete'
  title: string
  eventTitle: string
  rule: string
  showOccurrence: boolean
  pending: boolean
  onOccurrence: () => void
  onSeries: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t(kind === 'edit' ? 'calendar.scopeEditText' : 'calendar.scopeDeleteText', {
              title: eventTitle,
              rule,
            })}
          </DialogDescription>
        </DialogHeader>
        {/* The prototype's stack: three full-width buttons, 10px apart,
            18px below the text — the content grid's 16px plus this 2px. */}
        <div className="mt-0.5 flex flex-col gap-2.5">
          {showOccurrence && (
            <Button variant="secondary" disabled={pending} onClick={onOccurrence}>
              {t('calendar.editScopeOccurrence')}
            </Button>
          )}
          <Button
            variant={kind === 'edit' ? 'primary' : 'destructive'}
            disabled={pending}
            onClick={onSeries}
          >
            {t('calendar.editScopeSeries')}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function eventOf(events: StoredCalendarEvent[], eventId: string): StoredCalendarEvent | undefined {
  return events.find((event) => event.id === eventId)
}

/** The event whole: the date line, the title, the time and zone, the list
 *  card of rows, the created-by line — and, for a series, the explainer. */
function EventDetails({
  event,
  series,
  recurrence,
  profiles,
  spaceZone,
  recurring,
  locale,
}: {
  event: StoredCalendarEvent
  series: StoredCalendarEvent
  recurrence: Recurrence | undefined
  profiles: StoredMemberProfile[]
  spaceZone: string
  recurring: boolean
  locale: Locale
}) {
  const { t } = useTranslation()
  const time = eventTimeParts(event, t, locale)
  const duration = eventDuration(event, t)
  const reminder = event.reminder
  // The recipients once: the ids the names came from are the stack's hues.
  const recipients =
    reminder === undefined
      ? []
      : reminderRecipients(reminder, profiles, t('calendar.creatorUnknown'))
  const lead =
    reminder === undefined ? '' : reminderLeadLabel(reminder.leadMinutes, t).toLowerCase()
  return (
    <>
      {/* The prototype's head: the uppercase date, the display title, the
          time and zone line under it. */}
      <header className="mb-[18px]">
        <p className="mb-1.5 font-mono text-meta tracking-wide text-muted-foreground uppercase">
          {eventDateLine(event, locale)}
        </p>
        <h1 className="text-display">{event.title}</h1>
        <p className="mt-1.5 text-muted-foreground">
          {time.secondary === undefined ? time.primary : `${time.primary} · ${time.secondary}`}
        </p>
      </header>

      {/* The prototype's card: 60px rows led by bare 20px icons. */}
      <Card variant="list">
        <ItemGroup>
          <Item size="md">
            <ItemMedia>
              <Icon name={event.allDay ? 'sun' : 'clock'} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{time.primary}</ItemTitle>
              {duration !== undefined && (
                <ItemDescription>
                  {t('calendar.durationLabel')} {duration}
                </ItemDescription>
              )}
            </ItemContent>
          </Item>
          {recurring && recurrence !== undefined && (
            <Item size="md">
              <ItemMedia>
                <Icon name="repeat" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t(repeatLabelKey(recurrence.frequency))}</ItemTitle>
                <ItemDescription>
                  {seriesRuleLine(series, recurrence, t, locale, spaceZone)}
                </ItemDescription>
              </ItemContent>
            </Item>
          )}
          {reminder !== undefined && (
            <Item size="md">
              <ItemMedia>
                <Icon name="bell" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{t('calendar.reminderRowTitle', { lead })}</ItemTitle>
                <ItemDescription>{reminderFireLine(event, spaceZone, t)}</ItemDescription>
              </ItemContent>
            </Item>
          )}
          {reminder !== undefined && recipients.length > 0 && (
            <Item size="md">
              <ItemMedia>
                <Icon name="users" />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {reminder.recipients.everyone === true
                    ? t('calendar.reminderEveryone')
                    : t('calendar.reminderRecipients')}
                </ItemTitle>
                <ItemDescription>
                  {new Intl.ListFormat(locale, { type: 'conjunction' }).format(
                    recipients.map((recipient) => recipient.name),
                  )}
                </ItemDescription>
              </ItemContent>
              <AvatarStack>
                {recipients.map((recipient) => (
                  <Avatar key={recipient.id} size="sm" hue={hueFromId(recipient.id)}>
                    <AvatarFallback>{monogramOf(recipient.name)}</AvatarFallback>
                  </Avatar>
                ))}
              </AvatarStack>
            </Item>
          )}
        </ItemGroup>
      </Card>

      {/* The created-by line, the prototype's mono meta under the card. */}
      <p className="mt-3.5 px-1 font-mono text-meta tracking-wide text-muted-foreground uppercase">
        {createdLine(series, profiles, t, locale)}
      </p>

      {recurring && (
        <p className="mt-[22px] px-1 text-sm text-muted-foreground">
          {t('calendar.recurringExplainer')}
        </p>
      )}
    </>
  )
}

/** «с 3 октября 2026 · без даты окончания» — the rule row's second line:
 *  the series' own start and its bound, if one exists. */
function seriesRuleLine(
  series: StoredCalendarEvent,
  recurrence: Recurrence,
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: Locale,
  spaceZone: string,
): string {
  const startKey =
    series.allDay || series.startsAt === undefined
      ? series.date
      : zonedDateKey(series.startsAt, series.timezone ?? spaceZone)
  const start =
    startKey === undefined
      ? undefined
      : t('calendar.repeatSince', {
          date: formatDayOfYear(parseDateOnly(startKey) ?? { year: 0, month: 1, day: 1 }, locale),
        })
  // The year is part of the bound: a series ends in its year, and
  // «до 31 января» alone could be any of them.
  const bound =
    recurrence.until === undefined
      ? t('calendar.repeatNoEnd')
      : t('calendar.repeatUntilLine', {
          date: formatDayOfYear(
            parseDateOnly(recurrence.until) ?? { year: 0, month: 1, day: 1 },
            locale,
          ),
        })
  return start === undefined ? bound : `${start} · ${bound}`
}

/** «Создал: Аня · 12 сентября · изменено 28 сентября» — the mono line
 *  under the card; the change stamp shows where an edit has really
 *  happened (more than a minute after the creation). */
function createdLine(
  event: StoredCalendarEvent,
  profiles: StoredMemberProfile[],
  t: (key: string, values?: Record<string, unknown>) => string,
  locale: Locale,
): string {
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' })
  const created = format.format(new Date(event.createdAt))
  let line = t('calendar.creatorLine', {
    name: authorName(event.creatorId, profiles, t('calendar.creatorUnknown')),
    date: created,
  })
  if (Date.parse(event.updatedAt) - Date.parse(event.createdAt) > 60_000) {
    line += ` · ${t('calendar.changedMeta', { date: format.format(new Date(event.updatedAt)) })}`
  }
  return line
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

/** The label through a structurally typed translator, so the caller may
 *  work with the string — the scope dialog's description lowercases the
 *  label into its mid-sentence shape. */
export function repeatLabel(
  frequency: Recurrence['frequency'],
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  return t(repeatLabelKey(frequency))
}

function eventDateLine(event: StoredCalendarEvent, locale: Locale): string {
  const dateKey = event.allDay ? event.date : undefined
  const fallback = event.startsAt === undefined ? undefined : localDateKey(event.startsAt)
  const key = dateKey ?? fallback
  if (key === undefined) return ''
  const parts = parseDateOnly(key)
  return parts === undefined ? '' : formatDayFull(parts, locale)
}
