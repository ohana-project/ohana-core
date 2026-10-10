import type { Locale } from '@ohana/i18n'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDayLong, parseDateOnly } from '@/lib/calendar-dates.ts'
import { NoteBlock } from '@/ui/note-block.tsx'
import type { NearBirthday } from './wishlist-entries.ts'

/*
 * The birthday note (docs/design/screens/wishlists.html, issue #66; the
 * home screen's events column, issue #65): the shared note block naming
 * the event as its creator titled it, with the date, the days left and
 * the ideas really waiting in that member's list. The icon rides the
 * screen — the prototype's aside wears the cake, home's note the gift —
 * and the optional link closes the note, home's «Открыть вишлисты».
 */
export function BirthdayNote({
  birthday,
  openCount,
  locale,
  icon = 'cake',
  link,
  className,
}: {
  birthday: NearBirthday
  openCount: number
  locale: Locale
  icon?: 'cake' | 'gift'
  link?: ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const day = parseDateOnly(birthday.dayKey)
  return (
    <NoteBlock icon={icon} className={className}>
      {day !== undefined && (
        <p>
          {birthday.daysUntil === 0
            ? t('wishlist.birthdayNoteToday', { title: birthday.occurrence.title })
            : t('wishlist.birthdayNote', {
                title: birthday.occurrence.title,
                date: formatDayLong(day, locale),
                count: birthday.daysUntil,
              })}
        </p>
      )}
      <p className={day !== undefined ? 'mt-1' : undefined}>
        {t('wishlist.birthdayNoteIdeas', { count: openCount })}
      </p>
      {link !== undefined && (
        /* The prototype's home note closes with its own `sec-link`:
            `sm` text, weight 500, the accent colour, 8px below. */
        <div className="mt-2 [&_a]:inline-flex [&_a]:text-sm [&_a]:font-medium [&_a]:text-primary [&_a]:underline-offset-3 [&_a:hover]:underline">
          {link}
        </div>
      )}
    </NoteBlock>
  )
}
