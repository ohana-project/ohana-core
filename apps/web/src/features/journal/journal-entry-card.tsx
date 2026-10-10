import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Card } from '@/ui/card.tsx'
import { entryDay, entryExcerpt, entryTimestamp } from './journal-entries.ts'
import { EntryPhotoStrip } from './journal-photos.tsx'

/*
 * The feed's entry card (docs/design/screens/diary.html, issue #69): the
 * prototype's `a.card.card-pad.entry-card` — the 34px monogram, the name
 * and the «day · photo count» meta line, the serif 19px title, the
 * excerpt, and the full-width photo strip, the whole card one link to the
 * entry. A feature piece, not ui/: the home screen's recent entries reuse
 * it (issue #65), so it stays independent of the feed's screen state.
 */
export function EntryCard({
  entry,
  author,
  locale,
}: {
  entry: StoredJournalEntry
  /** The author's display name, resolved by the caller's profiles. */
  author: string
  locale: string
}) {
  const { t } = useTranslation()
  const count = entry.images?.length ?? 0
  const title = entry.title ?? entryExcerpt(entry.text, 60)
  return (
    <Link to="/journal/$entryId" params={{ entryId: entry.id }} className="block">
      <Card variant="padded" hoverable>
        {/* The `.entry-meta` row: 10px gap, 10px below (the prototype's
            inline `margin: 0 0 10px`). */}
        <div className="mb-2.5 flex items-center gap-2.5">
          <Avatar size="meta" hue={hueFromId(entry.authorId)}>
            <AvatarFallback>{monogramOf(author)}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 truncate text-sm font-semibold">{author}</span>
          <span className="min-w-0 truncate font-mono text-meta tracking-wide text-muted-foreground uppercase">
            {count > 0
              ? t('journal.entryMetaWithPhotos', {
                  day: entryDay(entryTimestamp(entry), locale),
                  count,
                })
              : entryDay(entryTimestamp(entry), locale)}
          </span>
        </div>
        {/* The prototype's `h3.display` at its inline 19px. */}
        <h3 className="font-display text-[19px] leading-[1.2] font-semibold tracking-[-0.015em]">
          {title}
        </h3>
        <p className="mt-[5px] line-clamp-3 text-sm text-muted-foreground">
          {entryExcerpt(entry.text)}
        </p>
        {/* The card's photo strip (docs/design/screens/diary.html): the
            worker's previews, cached by the service worker as they are
            viewed — never the originals (issue #17). */}
        <EntryPhotoStrip entry={entry} />
      </Card>
    </Link>
  )
}
