import type { Locale } from '@ohana/i18n'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { authorName } from '@/features/wishlist/wishlist-entries.ts'
import {
  formatDateOnly,
  formatZonedTime,
  todayDateOnly,
  zonedDateKey,
} from '@/lib/calendar-dates.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { timezoneOptions } from '@/lib/timezones.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { PickRow } from '@/ui/pick-row.tsx'
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
import { toast } from '@/ui/toast.tsx'
import { canEditEvent, eventById } from './calendar-entries.ts'
import { CalendarShell } from './calendar-shell.tsx'
import { REMINDER_LEAD_CHOICES, reminderLeadLabel } from './event-time.tsx'
import { occurrenceOf, type Recurrence } from './recurrence.ts'
import {
  calendarErrorMessage,
  type EventInput,
  type ReminderInput,
  useCalendarData,
  useCreateEvent,
  useUpdateEvent,
  useUpdateOccurrence,
} from './use-calendar.ts'

/*
 * The event editor (docs/design/screens/event-editor.html): the title, the
 * all-day switch, the date, the start and end times, the zone — whose
 * default is the space's (issue #1, story 64) — and, since issue #21, the
 * repeating section: the frequency and the optional end date. The editor
 * edits one thing at a time: a new event or the whole series (the series'
 * replace), or — when the link named an occurrence's original date — that
 * occurrence alone, which has no rule of its own. "This and following" is
 * not offered, by the ticket's design. The reminder's section of the
 * prototype belongs to #22 and is not here yet. The API composes the wall
 * time into instants; the editor's own guards only mirror the contract's
 * bounds.
 */

const REPEAT_CHOICES = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const

type RepeatChoice = (typeof REPEAT_CHOICES)[number]

export function EventEditorScreen({
  eventId,
  occurrenceDate,
}: {
  eventId?: string
  occurrenceDate?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as Locale
  const navigate = useNavigate()
  const { snapshot, events, profiles, space, downloaded } = useCalendarData()

  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const updateOccurrence = useUpdateOccurrence()

  const existing = eventId === undefined ? undefined : eventById(events, eventId)
  const occurrence =
    existing !== undefined && occurrenceDate !== undefined
      ? occurrenceOf(existing, occurrenceDate)
      : undefined
  // The occurrence the link named may be gone (cancelled): the editor has
  // nothing to seed and nothing to save.
  const missingOccurrence = occurrenceDate !== undefined && occurrence === undefined
  const editable =
    (existing === undefined || canEditEvent(existing, getActiveMemberId(), profiles)) &&
    !missingOccurrence
  // What the fields start from: the occurrence's effective fields — an
  // override's included — or the series row's own.
  const source = occurrence?.event ?? existing

  // The fields start from the stored event once it is available; after the
  // first keystroke the member's input wins — the journal editor's shape.
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [allDay, setAllDay] = useState<boolean | undefined>(undefined)
  const [date, setDate] = useState<string | undefined>(undefined)
  const [startTime, setStartTime] = useState<string | undefined>(undefined)
  const [endTime, setEndTime] = useState<string | undefined>(undefined)
  const [timezone, setTimezone] = useState<string | undefined>(undefined)
  const [repeat, setRepeat] = useState<RepeatChoice | undefined>(undefined)
  const [until, setUntil] = useState<string | undefined>(undefined)
  // The reminder (issue #22): the editor holds the attempt like the other
  // fields; the stored reminder seeds it. An occurrence's replacement has
  // no reminder of its own, so the section only shows for a new event or
  // the whole series.
  const [reminderOn, setReminderOn] = useState<boolean | undefined>(undefined)
  const [reminderLead, setReminderLead] = useState<number | undefined>(undefined)
  const [reminderEveryone, setReminderEveryone] = useState<boolean | undefined>(undefined)
  const [reminderMembers, setReminderMembers] = useState<string[] | undefined>(undefined)
  // The zone the member actually chose: left alone, the field shows the
  // space's zone and the API applies that default itself, so a space-zone
  // change between opening the form and saving is honoured.
  const [timezoneTouched, setTimezoneTouched] = useState(false)
  const [touched, setTouched] = useState(false)

  const spaceZone = space?.timezone ?? 'UTC'
  const effective = effectiveFields(
    source,
    {
      title,
      allDay,
      date,
      startTime,
      endTime,
      timezone,
      repeat,
      until,
    },
    spaceZone,
  )
  const occurrenceMode = occurrenceDate !== undefined

  // The reminder's effective fields: the member's edits, the stored
  // reminder where nothing was touched, the prototype's start (two hours,
  // the whole space) for one being added now.
  const storedReminder = source?.reminder
  const reminderVisible = !occurrenceMode
  const effectiveReminderOn = reminderOn ?? storedReminder !== undefined
  const effectiveReminderLead = reminderLead ?? storedReminder?.leadMinutes ?? 120
  // The lead options: the shared set, plus a stored off-list lead the
  // member kept (the API takes any minute count) so the select never
  // shows a value it has no option for.
  const leadChoices: number[] = (REMINDER_LEAD_CHOICES as readonly number[]).includes(
    effectiveReminderLead,
  )
    ? [...REMINDER_LEAD_CHOICES]
    : [effectiveReminderLead, ...REMINDER_LEAD_CHOICES]
  const effectiveReminderEveryone =
    reminderEveryone ??
    (storedReminder?.recipients.everyone === true || storedReminder === undefined)
  const effectiveReminderMembers = reminderMembers ?? storedReminder?.recipients.memberIds ?? []

  // The zone list is the runtime's, stable per locale; the event's own
  // spelling is prepended per render — the alias case is rare and cheap.
  const zoneOptions = useMemo(() => timezoneOptions(locale, new Date()), [locale])
  const zoneChoices = prependZone(zoneOptions, effective.timezone)
  const pending = createEvent.isPending || updateEvent.isPending || updateOccurrence.isPending
  const titleBlank = effective.title.trim().length === 0
  const dateBlank = effective.date.trim().length === 0
  const timesBlank = !effective.allDay && (effective.startTime === '' || effective.endTime === '')
  const endBeforeStart =
    !effective.allDay &&
    effective.startTime !== '' &&
    effective.endTime !== '' &&
    effective.endTime <= effective.startTime
  const untilBeforeStart =
    effective.repeat !== 'none' && effective.until !== '' && effective.until < effective.date
  // A named recipient list needs at least one name (the API refuses an
  // empty one), so the save waits until the picks say who.
  const reminderIncomplete =
    reminderVisible &&
    effectiveReminderOn &&
    !effectiveReminderEveryone &&
    effectiveReminderMembers.length === 0

  const editorTitle =
    eventId === undefined
      ? t('calendar.editorNewTitle')
      : occurrenceMode
        ? t('calendar.editorOccurrenceTitle')
        : t('calendar.editorEditTitle')

  const goBack = () => {
    if (existing !== undefined) {
      void navigate({
        to: '/calendar/$eventId',
        params: { eventId: existing.id },
        search: occurrenceMode && occurrenceDate !== undefined ? { date: occurrenceDate } : {},
      })
    } else {
      void navigate({ to: '/calendar' })
    }
  }

  const save = () => {
    setTouched(true)
    if (
      titleBlank ||
      dateBlank ||
      timesBlank ||
      endBeforeStart ||
      untilBeforeStart ||
      reminderIncomplete
    ) {
      return
    }
    const recurrence: Recurrence | undefined =
      !occurrenceMode && effective.repeat !== 'none'
        ? {
            frequency: effective.repeat,
            ...(effective.until === '' ? {} : { until: effective.until }),
          }
        : undefined
    const reminder: ReminderInput | undefined =
      reminderVisible && effectiveReminderOn
        ? {
            leadMinutes: effectiveReminderLead,
            recipients: effectiveReminderEveryone
              ? { everyone: true }
              : { memberIds: effectiveReminderMembers },
          }
        : undefined
    const input: EventInput = {
      title: effective.title.trim(),
      allDay: effective.allDay,
      date: effective.date,
      ...(effective.allDay
        ? {}
        : {
            startTime: effective.startTime,
            endTime: effective.endTime,
            // An edit keeps the zone the event already has — the form
            // shows its wall time there, and an untouched picker must not
            // silently re-zone it into the space's. A new event, and an
            // all-day one becoming timed (no zone of its own yet), leave
            // the zone to the API's default.
            timezone:
              timezoneTouched || source?.timezone !== undefined ? effective.timezone : undefined,
          }),
      ...(recurrence === undefined ? {} : { recurrence }),
      ...(reminder === undefined ? {} : { reminder }),
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
    if (occurrenceMode && occurrenceDate !== undefined) {
      // The occurrence's replace: an override keyed by the original date,
      // the series' rule untouched.
      updateOccurrence.mutate(
        { eventId: existing.id, originalDate: occurrenceDate, ...input },
        {
          onSuccess: () => {
            toast(t('calendar.savedToast'))
            goBack()
          },
          onError,
        },
      )
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
      title={editorTitle}
      backTo={existing === undefined ? '/calendar' : `/calendar/${existing.id}`}
      width="narrow"
    >
      <div className="flex flex-col gap-5 pt-6 pb-32">
        {snapshot.isPending ? (
          // Both kinds wait for the partition read: the edit needs its row,
          // the new event the space's zone to show as the default.
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
        ) : missingOccurrence ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="calendar" />
              </EmptyMedia>
              <EmptyTitle>{t('calendar.errors.occurrence_not_found')}</EmptyTitle>
            </Empty>
          </Card>
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
                {occurrenceMode
                  ? t('calendar.editingOccurrence', {
                      name: authorName(existing.creatorId, profiles, t('calendar.creatorUnknown')),
                    })
                  : t('calendar.editingBy', {
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
                    onCheckedChange={(checked) => {
                      const next = checked === true
                      setAllDay(next)
                      // An event that becomes timed needs a wall pair to
                      // compose; the evening default the new-event form
                      // carries is seeded rather than blocking Save on
                      // fields the member never saw.
                      if (!next) {
                        if (effective.startTime === '') setStartTime('18:00')
                        if (effective.endTime === '') setEndTime('21:00')
                      }
                    }}
                  />
                </div>
              </Card>

              {!effective.allDay && (
                <div className="flex gap-3">
                  <Field className="flex-1">
                    <FieldLabel htmlFor="event-start">{t('calendar.startTimeField')}</FieldLabel>
                    <Input
                      id="event-start"
                      type="time"
                      value={effective.startTime}
                      onChange={(event) => setStartTime(event.target.value)}
                      aria-invalid={(touched && timesBlank) || undefined}
                    />
                  </Field>
                  <Field className="flex-1">
                    <FieldLabel htmlFor="event-end">{t('calendar.endTimeField')}</FieldLabel>
                    <Input
                      id="event-end"
                      type="time"
                      value={effective.endTime}
                      onChange={(event) => setEndTime(event.target.value)}
                      aria-invalid={(touched && (endBeforeStart || timesBlank)) || undefined}
                    />
                    {touched && timesBlank ? (
                      <FieldError>{t('calendar.timesRequired')}</FieldError>
                    ) : touched && endBeforeStart ? (
                      <FieldError>{t('calendar.errors.event_end_before_start')}</FieldError>
                    ) : null}
                  </Field>
                </div>
              )}

              <Field data-invalid={(touched && dateBlank) || undefined}>
                <FieldLabel htmlFor="event-date">{t('calendar.dateField')}</FieldLabel>
                <Input
                  id="event-date"
                  type="date"
                  min="1900-01-01"
                  max="2200-12-31"
                  value={effective.date}
                  onChange={(event) => setDate(event.target.value)}
                  aria-invalid={(touched && dateBlank) || undefined}
                />
                {touched && dateBlank ? (
                  <FieldError>{t('calendar.dateRequired')}</FieldError>
                ) : null}
              </Field>

              {!effective.allDay && (
                <Field>
                  <FieldLabel htmlFor="event-tz">{t('calendar.timezoneField')}</FieldLabel>
                  <Select
                    id="event-tz"
                    value={effective.timezone}
                    onChange={(event) => {
                      setTimezone(event.target.value)
                      setTimezoneTouched(true)
                    }}
                  >
                    {zoneChoices.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <FieldDescription>{t('calendar.timezoneHint')}</FieldDescription>
                </Field>
              )}

              {!occurrenceMode && (
                <>
                  <Field>
                    <FieldLabel htmlFor="event-repeat">{t('calendar.repeatLabel')}</FieldLabel>
                    <Select
                      id="event-repeat"
                      value={effective.repeat}
                      onChange={(event) => setRepeat(event.target.value as RepeatChoice)}
                    >
                      {REPEAT_CHOICES.map((choice) => (
                        <option key={choice} value={choice}>
                          {t(repeatChoiceLabelKey(choice))}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {effective.repeat !== 'none' && (
                    <Field data-invalid={(touched && untilBeforeStart) || undefined}>
                      <FieldLabel htmlFor="event-until">{t('calendar.repeatUntil')}</FieldLabel>
                      <Input
                        id="event-until"
                        type="date"
                        min="1900-01-01"
                        max="2200-12-31"
                        value={effective.until}
                        onChange={(event) => setUntil(event.target.value)}
                        aria-invalid={(touched && untilBeforeStart) || undefined}
                      />
                      <FieldDescription>{t('calendar.repeatUntilHint')}</FieldDescription>
                      {touched && untilBeforeStart ? (
                        <FieldError>{t('calendar.errors.invalid_recurrence_until')}</FieldError>
                      ) : null}
                    </Field>
                  )}
                </>
              )}

              {reminderVisible && (
                <Card className="py-0">
                  <div className="flex min-h-16 items-center gap-3 px-5 py-3">
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-semibold">{t('calendar.reminderLabel')}</span>
                      <span className="text-sm text-muted-foreground">
                        {t('calendar.reminderHint')}
                      </span>
                    </span>
                    <Switch
                      aria-label={t('calendar.reminderLabel')}
                      checked={effectiveReminderOn}
                      onCheckedChange={(checked) => {
                        setReminderOn(checked === true)
                        // "Everyone" is the start: a named list begins as
                        // the creator themself, never an empty one.
                        if (
                          checked &&
                          !effectiveReminderEveryone &&
                          effectiveReminderMembers.length === 0
                        ) {
                          const me = getActiveMemberId()
                          if (me !== undefined) setReminderMembers([me])
                        }
                      }}
                    />
                  </div>
                  {effectiveReminderOn && (
                    <div className="flex flex-col gap-4 border-t border-border px-5 py-4">
                      <Field>
                        <FieldLabel htmlFor="event-reminder-lead">
                          {t('calendar.reminderLead')}
                        </FieldLabel>
                        <Select
                          id="event-reminder-lead"
                          value={String(effectiveReminderLead)}
                          onChange={(event) => setReminderLead(Number(event.target.value))}
                        >
                          {leadChoices.map((minutes) => (
                            <option key={minutes} value={String(minutes)}>
                              {reminderLeadLabel(minutes, t)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <div className="-mx-5 -mb-4 border-t border-border">
                        <PickRow
                          pressed={effectiveReminderEveryone}
                          onPressedChange={() => setReminderEveryone(true)}
                        >
                          {t('calendar.reminderEveryone')}
                        </PickRow>
                        {profiles
                          .filter((profile) => profile.archivedAt === undefined)
                          .map((profile) => (
                            <PickRow
                              key={profile.id}
                              pressed={effectiveReminderMembers.includes(profile.id)}
                              onPressedChange={(pressed) => {
                                setReminderEveryone(false)
                                setReminderMembers(
                                  pressed
                                    ? [...effectiveReminderMembers, profile.id]
                                    : effectiveReminderMembers.filter((id) => id !== profile.id),
                                )
                              }}
                              leading={
                                <Avatar size="sm" hue={hueFromId(profile.id)}>
                                  <AvatarFallback>
                                    {monogramOf(profile.displayName ?? profile.name)}
                                  </AvatarFallback>
                                </Avatar>
                              }
                            >
                              {profile.displayName ?? profile.name}
                            </PickRow>
                          ))}
                        <p className="px-3.5 py-2.5 text-sm text-muted-foreground">
                          {reminderIncomplete
                            ? t('calendar.reminderRecipientsRequired')
                            : t('calendar.reminderRecipientsHint')}
                        </p>
                      </div>
                    </div>
                  )}
                </Card>
              )}
            </FieldGroup>

            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-4 backdrop-blur lg:sticky lg:bottom-auto lg:mt-2 lg:border-0 lg:bg-transparent lg:p-0">
              <div className="mx-auto flex max-w-xl gap-2 lg:justify-end">
                <Button variant="secondary" className="flex-1 lg:flex-none" onClick={goBack}>
                  {t('calendar.cancel')}
                </Button>
                <Button className="flex-1 lg:flex-none" disabled={pending} onClick={save}>
                  {pending ? <Spinner /> : <Icon name="check" />}
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

/** «Не повторять» … — the editor's repeat choices and the event screen's
 *  series line share the vocabulary. */
export function repeatChoiceLabelKey(choice: RepeatChoice) {
  switch (choice) {
    case 'none':
      return 'calendar.repeatNone' as const
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

/**
 * The picker's options: every zone the runtime knows, plus the event's own
 * when the runtime does not list its spelling (a link alias an older
 * client stored) — a select whose value has no option shows the wrong one.
 */
function prependZone(options: ReturnType<typeof timezoneOptions>, current: string) {
  if (current !== '' && !options.some((option) => option.value === current)) {
    return [{ value: current, label: current }, ...options]
  }
  return options
}

interface EditorFields {
  title: string
  allDay: boolean
  date: string
  startTime: string
  endTime: string
  timezone: string
  repeat: RepeatChoice
  until: string
}

/**
 * The fields the form shows: the member's edits where they exist, the
 * stored event's values where they do not — a timed event's times read in
 * the zone the event keeps, the wall time it was created with, the
 * series' rule beside them — and the sensible starts for a brand-new one.
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
    repeat?: RepeatChoice
    until?: string
  },
  spaceZone: string,
): EditorFields {
  if (existing === undefined) {
    const today = todayDateOnly()
    return {
      title: edits.title ?? '',
      allDay: edits.allDay ?? false,
      date: edits.date ?? formatDateOnly(today),
      startTime: edits.startTime ?? '18:00',
      endTime: edits.endTime ?? '21:00',
      timezone: edits.timezone ?? spaceZone,
      repeat: edits.repeat ?? 'none',
      until: edits.until ?? '',
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
    repeat: edits.repeat ?? existing.recurrence?.frequency ?? 'none',
    until: edits.until ?? existing.recurrence?.until ?? '',
  }
}
