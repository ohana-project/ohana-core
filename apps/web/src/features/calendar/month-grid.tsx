import type { Locale } from '@ohana/i18n'
import { useTranslation } from 'react-i18next'
import type { StoredCalendarEvent } from '@/data/local-store.ts'
import {
  type DateOnly,
  formatDateOnly,
  formatDayLong,
  type MonthDay,
  weekdayHeaders,
} from '@/lib/calendar-dates.ts'
import { cn } from '@/lib/cn'

/*
 * The calendar's month grid (docs/design/screens/calendar.html, issue
 * #73): square cells with 6px gaps, the day's number mono 14.5px in a
 * 30px circle, today the prototype's 7% accent cell (`--accent-faint`)
 * with the filled accent circle behind the number, and a dot per event —
 * accent for the timed kind, warn for the all-day kind, a past day at
 * half opacity, out-of-month at 0.4, a fourth and later hidden. Below
 * 560px the prototype's compact values: a 24px circle at 11.5px, 5px
 * dots, 2px padding and gap (the `max-[559px]` variants — the
 * prototype's `@media (max-width: 559px)`; the class names are spelled
 * out in full because Tailwind's scanner reads raw text, not
 * expressions). Only days with events answer a tap — the prototype's
 * `.cal-day.has-ev`, the day sheet's door —, the rest are plain cells.
 */

function DayCell({
  day,
  events,
  today,
  locale,
  onOpenDay,
}: {
  day: MonthDay
  events: StoredCalendarEvent[]
  today: DateOnly
  locale: Locale
  onOpenDay: (date: DateOnly) => void
}) {
  const { t } = useTranslation()
  const { date, inMonth } = day
  const key = formatDateOnly(date)
  const isToday = key === formatDateOnly(today)
  const isPast = key < formatDateOnly(today)
  const busy = events.length > 0

  const cell = cn(
    'flex aspect-square flex-col items-center justify-center gap-[7px] rounded-md p-1.5',
    // The compact grid: 2px padding, 2px gap.
    'max-[559px]:gap-[2px] max-[559px]:p-0.5',
    // Today is the prototype's 7% accent tint, the same in both themes —
    // the number sits on the filled circle, not on the tint.
    isToday && 'bg-primary-faint',
  )

  const content = (
    <>
      <span
        className={cn(
          // The day's number: mono 14.5px in a 30px circle; the compact
          // grid's 24px circle at 11.5px.
          'grid size-[30px] place-items-center rounded-full font-mono text-[14.5px] leading-none tabular-nums',
          'max-[559px]:size-6 max-[559px]:text-[11.5px]',
          isToday
            ? 'bg-primary font-medium text-primary-foreground'
            : inMonth
              ? 'text-foreground'
              : // The out-of-month dim, the prototype's muted at 45%.
                'text-muted-faint',
        )}
      >
        {date.day}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'flex min-h-[7px] items-center justify-center gap-[5px]',
          'max-[559px]:min-h-[5px] max-[559px]:gap-[3px]',
        )}
      >
        {events.slice(0, 3).map((event) => (
          <i
            key={event.id}
            className={cn(
              'size-[7px] rounded-full max-[559px]:size-[5px]',
              // Accent for the timed kind, warn for the all-day kind.
              event.allDay ? 'bg-warn' : 'bg-primary',
              // The out-of-month dim wins over the past day's, like the
              // prototype's `.out` rule over `.past`.
              !inMonth ? 'opacity-40' : isPast ? 'opacity-50' : undefined,
            )}
          />
        ))}
      </span>
    </>
  )

  if (!busy) return <div className={cell}>{content}</div>

  return (
    <button
      type="button"
      onClick={() => onOpenDay(date)}
      aria-label={t('calendar.dayWithEvents', {
        count: events.length,
        day: formatDayLong(date, locale),
      })}
      className={cn(
        cell,
        'cursor-pointer transition-colors duration-(--t-fast) ease-(--ease)',
        // The hover fills follow the app's one recipe: fg-soft on a plain
        // day, the soft accent on today (the prototype's own accent 12%).
        isToday
          ? 'hover:bg-primary-soft active:bg-primary-soft'
          : 'hover:bg-accent active:bg-accent',
      )}
    >
      {content}
    </button>
  )
}

export function MonthGrid({
  grid,
  byDate,
  today,
  locale,
  onOpenDay,
}: {
  grid: MonthDay[]
  byDate: Map<string, StoredCalendarEvent[]>
  today: DateOnly
  locale: Locale
  onOpenDay: (date: DateOnly) => void
}) {
  return (
    <>
      <div aria-hidden="true" className="mb-1.5 grid grid-cols-7 gap-1.5">
        {weekdayHeaders(locale).map((day) => (
          <span
            key={day}
            className="pt-[2px] text-center font-mono text-[10.5px] tracking-[0.06em] text-muted-foreground uppercase"
          >
            {day}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {grid.map((day) => {
          const key = formatDateOnly(day.date)
          return (
            <DayCell
              key={key}
              day={day}
              events={byDate.get(key) ?? []}
              today={today}
              locale={locale}
              onOpenDay={onOpenDay}
            />
          )
        })}
      </div>
    </>
  )
}
