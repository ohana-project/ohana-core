import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { CountBadge } from '@/ui/count-badge.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Fab } from '@/ui/fab.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import {
  authorName,
  entryDay,
  entryExcerpt,
  entryTimestamp,
  journalDrafts,
  journalFeed,
} from './journal-entries.ts'
import { JournalShell } from './journal-shell.tsx'
import { useJournalData } from './use-journal.ts'

/*
 * The shared journal feed (docs/design/screens/diary.html): the space's
 * published entries, newest first, every row naming its author, paginated
 * for reading. The feed answers from the member's synchronised partition
 * (issue #14), so it reads the same online and offline (ADR-0002); the
 * page size mirrors the API's feed contract (issue #15). Beside it, the
 * member's own corner: the drafts only they see.
 */

const PAGE_SIZE = 20

export function JournalScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, entries, profiles, downloaded } = useJournalData()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const feed = journalFeed(entries)
  const drafts = journalDrafts(entries)
  const visible = feed.slice(0, visibleCount)

  const newEntry = (
    <Button size="sm" onClick={() => void navigate({ to: '/journal/new' })}>
      <Icon name="plus" />
      {t('journal.newEntry')}
    </Button>
  )

  return (
    <JournalShell
      title={t('journal.title')}
      actions={newEntry}
      width={drafts.length > 0 ? 'wide' : 'default'}
    >
      <div
        className={
          drafts.length > 0
            ? 'grid gap-8 pt-6 desktop:grid-cols-[1.6fr_1fr] desktop:items-start'
            : 'pt-6'
        }
      >
        <div className="flex min-w-0 flex-col gap-4">
          {snapshot.isPending ? (
            <div className="grid place-items-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : !downloaded ? (
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="cloud-off" />
                </EmptyMedia>
                <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
                <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
              </Empty>
            </Card>
          ) : visible.length === 0 ? (
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="book" />
                </EmptyMedia>
                <EmptyTitle>{t('journal.feedEmptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('journal.feedEmptyText')}</EmptyDescription>
                <EmptyMedia className="mt-3">
                  <Button onClick={() => void navigate({ to: '/journal/new' })}>
                    <Icon name="plus" />
                    {t('journal.writeFirst')}
                  </Button>
                </EmptyMedia>
              </Empty>
            </Card>
          ) : (
            <>
              {visible.map((entry) => (
                <FeedCard
                  key={entry.id}
                  entry={entry}
                  author={authorName(entry.authorId, profiles, t('journal.authorUnknown'))}
                  locale={i18n.language}
                />
              ))}
              {feed.length > visible.length && (
                <Button
                  variant="secondary"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >
                  {t('journal.loadMore')}
                </Button>
              )}
            </>
          )}
        </div>

        {drafts.length > 0 && (
          <aside className="flex flex-col gap-3 desktop:sticky desktop:top-20">
            <SectionHeader title={t('journal.onlyForYou')} />
            <Card className="py-0">
              <ItemGroup>
                <Item size="lg" render={<Link to="/journal/drafts" />}>
                  <ItemMedia>
                    <Icon name="file-text" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>
                      {t('journal.myDrafts')} <CountBadge>{drafts.length}</CountBadge>
                    </ItemTitle>
                    <ItemDescription>
                      {t('journal.draftsLatest', {
                        title: drafts[0]?.title ?? entryExcerpt(drafts[0]?.text ?? '', 40),
                      })}
                    </ItemDescription>
                  </ItemContent>
                  <Icon name="chevron-right" className="text-muted-foreground" />
                </Item>
              </ItemGroup>
            </Card>
            <p className="px-1 text-meta text-muted-foreground">{t('journal.draftsHint')}</p>
          </aside>
        )}
      </div>

      <Fab
        aria-label={t('journal.newEntry')}
        onClick={() => void navigate({ to: '/journal/new' })}
      />
    </JournalShell>
  )
}

function FeedCard({
  entry,
  author,
  locale,
}: {
  entry: StoredJournalEntry
  author: string
  locale: string
}) {
  const title = entry.title ?? entryExcerpt(entry.text, 60)
  return (
    <Link to="/journal/$entryId" params={{ entryId: entry.id }} className="block">
      <Card hoverable>
        <div className="flex items-center gap-2.5">
          <Avatar size="sm" hue={hueFromId(entry.authorId)}>
            <AvatarFallback>{monogramOf(author)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">{author}</span>
            <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
              {entryDay(entryTimestamp(entry), locale)}
            </span>
          </div>
        </div>
        <h3 className="text-h2">{title}</h3>
        <p className="line-clamp-3 text-sm text-muted-foreground">{entryExcerpt(entry.text)}</p>
      </Card>
    </Link>
  )
}
