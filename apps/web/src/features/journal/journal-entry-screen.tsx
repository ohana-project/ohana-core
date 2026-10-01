import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { authorName, entryById, entryMoment, entryTimestamp } from './journal-entries.ts'
import { JournalShell } from './journal-shell.tsx'
import { useJournalData } from './use-journal.ts'

/*
 * One entry (docs/design/screens/diary-entry.html): the author's name and
 * the moment it was shared, the title, and the text. A draft carries its
 * badge and is opened by its author alone — the server never delivered it
 * to anyone else. Photos arrive with their own ticket (#17).
 */
export function JournalEntryScreen({ entryId }: { entryId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, entries, profiles } = useJournalData()

  const entry = entryById(entries, entryId)
  const author = entry
    ? authorName(entry.authorId, profiles, t('journal.authorUnknown'))
    : undefined
  const mine = entry !== undefined && entry.authorId === getActiveMemberId()

  return (
    <JournalShell title={t('journal.entryTitle')} backTo="/journal" width="narrow">
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : snapshot.data?.revision === undefined ? (
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        </Card>
      ) : entry === undefined || author === undefined ? (
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="file-text" />
            </EmptyMedia>
            <EmptyTitle>{t('journal.entryMissingTitle')}</EmptyTitle>
            <EmptyDescription>{t('journal.entryMissingText')}</EmptyDescription>
          </Empty>
        </Card>
      ) : (
        <article className="flex flex-col gap-4 pt-6">
          <header className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <Avatar size="sm" hue={hueFromId(entry.authorId)}>
                <AvatarFallback>{monogramOf(author)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">{author}</span>
                <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
                  {entryMoment(entryTimestamp(entry), i18n.language)}
                </span>
              </div>
              {entry.state === 'draft' && <Badge variant="warn">{t('journal.draftBadge')}</Badge>}
              {mine && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void navigate({ to: '/journal/$entryId/edit', params: { entryId } })
                  }
                >
                  <Icon name="edit" />
                  {t('journal.edit')}
                </Button>
              )}
            </div>
            {entry.title !== undefined && <h1 className="text-display-lg">{entry.title}</h1>}
          </header>

          <div className="flex flex-col gap-4 text-[16px] leading-relaxed">
            {entry.text.split(/\n{2,}/).map((paragraph, index) => (
              <p
                // The paragraphs are a static split of one text: they
                // never reorder, and two of them may begin — or be —
                // identical, so the position is the only stable identity.
                // biome-ignore lint/suspicious/noArrayIndexKey: static list, never reordered
                key={index}
                className="whitespace-pre-line"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </article>
      )}
    </JournalShell>
  )
}
