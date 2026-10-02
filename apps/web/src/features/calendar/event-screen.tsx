import type { Locale } from '@ohana/i18n'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredCalendarEvent, StoredMemberProfile } from '@/data/local-store.ts'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { authorName } from '@/features/wishlist/wishlist-entries.ts'
import { formatDayFull, localDateKey, parseDateOnly } from '@/lib/calendar-dates.ts'
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
import { calendarErrorMessage, useCalendarData, useDeleteEvent } from './use-calendar.ts'

/*
 * The event screen (docs/design/screens/event.html): one event whole —
 * its device-local time with the zone the event keeps, its length, who
 * created it. The edit and the delete belong to the event's creator and
 * the owners (issue #20, the journal's moderation model); everyone else
 * reads. The rows come from the synchronised partition, so the screen
 * answers offline like the month (ADR-0002).
 */
export function EventScreen({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const navigate = useNavigate()
  const { snapshot, events, profiles, downloaded } = useCalendarData()
  const removeEvent = useDeleteEvent()
  const [confirming, setConfirming] = useState(false)

  const event = snapshot.isPending ? undefined : eventOf(events, eventId)
  const editable = event !== undefined && canEditEvent(event, getActiveMemberId(), profiles)

  const onDelete = () => {
    removeEvent.mutate(
      { eventId },
      {
        onSuccess: () => {
          toast(t('calendar.deletedToast'))
          void navigate({ to: '/calendar' })
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
        ) : (
          <EventDetails
            event={event}
            profiles={profiles}
            editable={editable}
            locale={locale}
            onAskDelete={() => setConfirming(true)}
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
            <Button variant="destructive" disabled={removeEvent.isPending} onClick={onDelete}>
              {removeEvent.isPending ? <Spinner className="size-4" /> : <Icon name="trash" />}
              {t('calendar.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CalendarShell>
  )
}

function eventOf(events: StoredCalendarEvent[], eventId: string): StoredCalendarEvent | undefined {
  return events.find((event) => event.id === eventId)
}

/** The event whole: the date line, the title, the time and zone, the
 *  length, the creator — and the edit and delete of its moderator set. */
function EventDetails({
  event,
  profiles,
  editable,
  locale,
  onAskDelete,
}: {
  event: StoredCalendarEvent
  profiles: StoredMemberProfile[]
  editable: boolean
  locale: Locale
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
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">{duration}</span>
                <span className="text-sm text-muted-foreground">{t('calendar.durationLabel')}</span>
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
          <Button
            variant="secondary"
            render={<Link to="/calendar/$eventId/edit" params={{ eventId: event.id }} />}
          >
            <Icon name="edit" />
            {t('calendar.edit')}
          </Button>
          <Button variant="ghost" onClick={onAskDelete}>
            <Icon name="trash" />
            {t('calendar.delete')}
          </Button>
        </div>
      )}
    </>
  )
}

function eventDateLine(event: StoredCalendarEvent, locale: Locale): string {
  const dateKey = event.allDay ? event.date : undefined
  const fallback = event.startsAt === undefined ? undefined : localDateKey(event.startsAt)
  const key = dateKey ?? fallback
  if (key === undefined) return ''
  const parts = parseDateOnly(key)
  return parts === undefined ? '' : formatDayFull(parts, locale)
}
