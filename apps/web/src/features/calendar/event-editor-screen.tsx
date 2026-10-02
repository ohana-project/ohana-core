import type { Locale } from '@ohana/i18n'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { authorName } from '@/features/wishlist/wishlist-entries.ts'
import { formatZonedTime, todayDateOnly, zonedDateKey } from '@/lib/calendar-dates.ts'
import { timezoneOptions } from '@/lib/timezones.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
import { toast } from '@/ui/toast.tsx'
import { canEditEvent, eventById } from './calendar-entries.ts'
import { CalendarShell } from './calendar-shell.tsx'
import {
  calendarErrorMessage,
  type EventInput,
  useCalendarData,
  useCreateEvent,
  useUpdateEvent,
} from './use-calendar.ts'

/*
 * The event editor (docs/design/screens/event-editor.html): the title, the
 * all-day switch, the date, the start and end times, and the zone — whose
 * default is the space's (issue #64 of the spec). The repeating section of
 * the prototype and the reminder's belong to later tickets (#21, #22) and
 * are not here yet. The API composes the wall time into instants; the
 * editor's own guards only mirror the contract's bounds.
 */
export function EventEditorScreen({ eventId }: { eventId?: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const navigate = useNavigate()
  const { snapshot, events, profiles, space, downloaded } = useCalendarData()

  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()

  const existing = eventId === undefined ? undefined : eventById(events, eventId)
  const editable = existing === undefined || canEditEvent(existing, getActiveMemberId(), profiles)

  // The fields start from the stored event once it is available; after the
  // first keystroke the member's input wins — the journal editor's shape.
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [allDay, setAllDay] = useState<boolean | undefined>(undefined)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [startTime, setStartTime] = useState<string | undefined>(undefined)
  const [endTime, setEndTime] = useState<string | undefined>(undefined)
  const [timezone, setTimezone] = useState<string | undefined>(undefined)
  const [touched, setTouched] = useState(false)

  const spaceZone = space?.timezone ?? 'UTC'
  const effective = effectiveFields(
    existing,
    {
      title,
      allDay,
      date,
      startTime,
      endTime,
      timezone,
    },
    spaceZone,
  )

  const pending = createEvent.isPending || updateEvent.isPending
  const titleBlank = effective.title.trim().length === 0
  const timesBlank = !effective.allDay && (effective.startTime === '' || effective.endTime === '')
  const endBeforeStart =
    !effective.allDay &&
    effective.startTime !== '' &&
    effective.endTime !== '' &&
    effective.endTime <= effective.startTime

  const goBack = () => {
    if (existing !== undefined)
      void navigate({ to: '/calendar/$eventId', params: { eventId: existing.id } })
    else void navigate({ to: '/calendar' })
  }

  const save = () => {
    setTouched(true)
    if (titleBlank || timesBlank || endBeforeStart) return
    const input: EventInput = {
      title: effective.title.trim(),
      allDay: effective.allDay,
      date: effective.date,
      ...(effective.allDay
        ? {}
        : {
            startTime: effective.startTime,
            endTime: effective.endTime,
            timezone: effective.timezone || undefined,
          }),
    }
    const onError = (error: unknown) => toast(calendarErrorMessage(error, t), 'danger')
    if (existing === undefined) {
      createEvent.mutate(input, {
        onSuccess: (created) => {
          toast(t('calendar.createdToast'))
          void navigate({ to: '/calendar/$eventId', params: { eventId: created.id } })
        },
        onError,
      })
      return
    }
    updateEvent.mutate(
      { eventId: existing.id, ...input },
      {
        onSuccess: () => {
          toast(t('calendar.savedToast'))
          goBack()
        },
        onError,
      },
    )
  }

  return (
    <CalendarShell
      title={eventId === undefined ? t('calendar.editorNewTitle') : t('calendar.editorEditTitle')}
      backTo={existing === undefined ? '/calendar' : `/calendar/${existing.id}`}
      width="narrow"
    >
      <div className="flex flex-col gap-5 pt-6 pb-32">
        {eventId !== undefined && snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : eventId !== undefined && existing === undefined ? (
          !downloaded ? (
            // Nothing is downloaded: the event may exist, this device
            // cannot say (ADR-0002).
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="cloud-off" />
                </EmptyMedia>
                <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
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
        ) : !editable ? (
          // Only the creator — or an owner — edits an event (issue #20);
          // everyone else is refused before typing into a form the API
          // would turn away.
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="lock" />
              </EmptyMedia>
              <EmptyTitle>{t('calendar.errors.creator_required')}</EmptyTitle>
            </Empty>
          </Card>
        ) : (
          <>
            {existing !== undefined && (
              <p className="px-1 text-sm text-muted-foreground">
                {t('calendar.editingBy', {
                  name: authorName(existing.creatorId, profiles, t('calendar.creatorUnknown')),
                })}
              </p>
            )}

            <FieldGroup>
              <Field data-invalid={(touched && titleBlank) || undefined}>
                <FieldLabel htmlFor="event-title">{t('calendar.titleField')}</FieldLabel>
                <Input
                  id="event-title"
                  value={effective.title}
                  maxLength={200}
                  placeholder={t('calendar.titlePlaceholder')}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-invalid={(touched && titleBlank) || undefined}
                />
                {touched && titleBlank ? (
                  <FieldError>{t('calendar.titleRequired')}</FieldError>
                ) : null}
              </Field>

              <Card className="py-0">
                <div className="flex min-h-16 items-center gap-3 px-5 py-3">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold">{t('calendar.allDay')}</span>
                    <span className="text-sm text-muted-foreground">
                      {t('calendar.allDayHint')}
                    </span>
                  </span>
                  <Switch
                    aria-label={t('calendar.allDay')}
                    checked={effective.allDay}
                    onCheckedChange={(checked) => setAllDay(checked === true)}
                  />
                </div>
              </Card>

              <div className="flex gap-3">
                <Field className="flex-1">
                  <FieldLabel htmlFor="event-start">{t('calendar.startTimeField')}</FieldLabel>
                  <Input
                    id="event-start"
                    type="time"
                    value={effective.startTime}
                    disabled={effective.allDay}
                    onChange={(event) => setStartTime(event.target.value)}
                  />
                </Field>
                <Field className="flex-1">
                  <FieldLabel htmlFor="event-end">{t('calendar.endTimeField')}</FieldLabel>
                  <Input
                    id="event-end"
                    type="time"
                    value={effective.endTime}
                    disabled={effective.allDay}
                    onChange={(event) => setEndTime(event.target.value)}
                    aria-invalid={(touched && endBeforeStart) || undefined}
                  />
                  {touched && endBeforeStart ? (
                    <FieldError>{t('calendar.errors.event_end_before_start')}</FieldError>
                  ) : null}
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="event-date">{t('calendar.dateField')}</FieldLabel>
                <Input
                  id="event-date"
                  type="date"
                  value={effective.date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </Field>

              {!effective.allDay && (
                <Field>
                  <FieldLabel htmlFor="event-tz">{t('calendar.timezoneField')}</FieldLabel>
                  <Select
                    id="event-tz"
                    value={effective.timezone}
                    onChange={(event) => setTimezone(event.target.value)}
                  >
                    {timezoneOptions(locale, new Date()).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <FieldDescription>{t('calendar.timezoneHint')}</FieldDescription>
                </Field>
              )}
            </FieldGroup>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-4 backdrop-blur lg:sticky lg:bottom-auto lg:mt-2 lg:border-0 lg:bg-transparent lg:p-0">
              <div className="mx-auto flex max-w-xl gap-2 lg:justify-end">
                <Button variant="secondary" className="flex-1 lg:flex-none" onClick={goBack}>
                  {t('calendar.cancel')}
                </Button>
                <Button className="flex-1 lg:flex-none" disabled={pending} onClick={save}>
                  {pending ? <Spinner className="size-4" /> : <Icon name="check" />}
                  {t('calendar.save')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </CalendarShell>
  )
}

interface EditorFields {
  title: string
  allDay: boolean
  date: string
  startTime: string
  endTime: string
  timezone: string
}

/**
 * The fields the form shows: the member's edits where they exist, the
 * stored event's values where they do not — a timed event's times read in
 * the zone the event keeps, the wall time it was created with — and the
 * sensible starts for a brand-new one.
 */
function effectiveFields(
  existing: ReturnType<typeof eventById>,
  edits: {
    title?: string
    allDay?: boolean
    date?: string
    startTime?: string
    endTime?: string
    timezone?: string
  },
  spaceZone: string,
): EditorFields {
  if (existing === undefined) {
    const today = todayDateOnly()
    return {
      title: edits.title ?? '',
      allDay: edits.allDay ?? false,
      date:
        edits.date ??
        `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`,
      startTime: edits.startTime ?? '18:00',
      endTime: edits.endTime ?? '21:00',
      timezone: edits.timezone ?? spaceZone,
    }
  }
  const zone = existing.timezone ?? spaceZone
  const dateKey =
    existing.allDay || existing.startsAt === undefined
      ? existing.date
      : zonedDateKey(existing.startsAt, zone)
  return {
    title: edits.title ?? existing.title,
    allDay: edits.allDay ?? existing.allDay,
    date: edits.date ?? dateKey ?? '',
    startTime:
      edits.startTime ??
      (existing.allDay || existing.startsAt === undefined
        ? ''
        : formatZonedTime(existing.startsAt, zone)),
    endTime:
      edits.endTime ??
      (existing.allDay || existing.endsAt === undefined
        ? ''
        : formatZonedTime(existing.endsAt, zone)),
    timezone: edits.timezone ?? zone,
  }
}
