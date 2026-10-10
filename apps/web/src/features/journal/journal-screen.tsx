import type { Locale } from '@ohana/i18n'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatMonthTitle } from '@/lib/calendar-dates.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { CountBadge } from '@/ui/count-badge.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Fab } from '@/ui/fab.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '@/ui/item.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import {
  authorName,
  entryDay,
  entryExcerpt,
  entryMonthGroups,
  journalDrafts,
  journalFeed,
} from './journal-entries.ts'
import { EntryCard } from './journal-entry-card.tsx'
import { JournalShell } from './journal-shell.tsx'
import { useJournalData, useTrash } from './use-journal.ts'

/*
 * The shared journal feed (docs/design/screens/diary.html): the space's
 * published entries, newest first, grouped under the prototype's sticky
 * month labels, every row naming its author, paginated for reading. The
 * feed answers from the member's synchronised partition (issue #14), so
 * it reads the same online and offline (ADR-0002); the page size mirrors
 * the API's feed contract (issue #15). Beside it, the member's own
 * corner: the drafts only they see.
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
  // The corner is there for every downloaded section: the drafts item
  // counts the drafts only when there are any, and the trash item is the
  // way back to whatever was removed (issue #16). While the journal's
  // replay is owed, the rows an interrupted replay left are a fraction,
  // and a partial count beside the offline message would contradict it.
  const showAside = downloaded

  const newEntry = (
    <Button size="sm" onClick={() => void navigate({ to: '/journal/new' })}>
      <Icon name="plus" />
      {t('journal.newEntry')}
    </Button>
  )

  return (
    // The prototype's `.content` default width: diary.html carries no
    // content-wide, unlike the calendar's own screen.
    <JournalShell title={t('journal.title')} desktopActions={newEntry}>
      {/* The prototype's `.diary-grid`: one column 12px apart on a phone,
          the 1.6fr / 1fr split with the 32px gap from 920px. */}
      <div
        className={
          showAside
            ? 'grid gap-3 pt-6 desktop:grid-cols-[1.6fr_1fr] desktop:gap-8 desktop:items-start'
            : 'pt-6'
        }
      >
        {/* The prototype's `.diary-main`: the feed's 12px column. */}
        <div className="flex min-w-0 flex-col gap-3">
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
            // The prototype's empty state stands bare (README "Cards"): no
            // card around it, its button below the text.
            <Empty className="py-14">
              <EmptyMedia>
                <Icon name="book" />
              </EmptyMedia>
              <EmptyTitle>{t('journal.feedEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('journal.feedEmptyText')}</EmptyDescription>
              <EmptyContent>
                <Button onClick={() => void navigate({ to: '/journal/new' })}>
                  <Icon name="plus" />
                  {t('journal.writeFirst')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <>
              {entryMonthGroups(visible).map((group) => (
                // The prototype's `.diary-main` is one flex column, so the
                // month's pieces flow in it with the same 12px gap — a
                // section that stacked as plain blocks would let the label's
                // negative margin collapse and overlap its first card.
                <section
                  key={`${group.year}-${group.month}`}
                  className="flex min-w-0 flex-col gap-3"
                >
                  {/* The prototype's `.month-label`: sticky under the top
                      bar, mono 12px, a trailing hairline; the negative
                      margins cancel the column's 12px gap, the padding
                      gives the label its own space. */}
                  <p className="sticky top-[var(--topbar-h)] z-5 -my-3 flex items-center gap-3 bg-background pt-[22px] pb-2.5 font-mono text-[12px] tracking-[0.08em] text-muted-foreground uppercase">
                    {formatMonthTitle(group.year, group.month, i18n.language as Locale)}
                    <span aria-hidden="true" className="flex-1 border-t border-border" />
                  </p>
                  {group.entries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      author={authorName(entry.authorId, profiles, t('journal.authorUnknown'))}
                      locale={i18n.language}
                    />
                  ))}
                </section>
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

        {showAside && (
          <aside className="flex min-w-0 flex-col gap-3 desktop:sticky desktop:top-[calc(var(--topbar-h)+24px)]">
            <SectionHeader title={t('journal.onlyForYou')} className="my-1.5" />
            {/* The prototype's `.card.list`: rows flush, the corners clip
                them; the rows at the prototype's inline 60px (`md`). */}
            <Card variant="list">
              <ItemGroup>
                {drafts.length > 0 && (
                  <Item size="md" render={<Link to="/journal/drafts" />}>
                    <ItemMedia variant="icon">
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
                )}
                <TrashRow />
              </ItemGroup>
            </Card>
            {/* The prototype's note: the sm size (13.5px), inset 4px. */}
            <p className="px-1 text-sm text-muted-foreground">{t('journal.draftsHint')}</p>
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

/*
 * The corner's trash row (docs/design/screens/diary.html). The trash is
 * online-only data (issue #16) — a trashed entry has left every device's
 * synchronised partition — so the count badge and the dated line are the
 * server's answer, never a local claim: until the trash list has answered
 * (or where it cannot) the row keeps to what is always true, the generic
 * hint. The date is the earliest one, the prototype's «записи удалятся
 * окончательно …» line.
 */
function TrashRow() {
  const { t, i18n } = useTranslation()
  const trash = useTrash()
  const rows = trash.data?.entries
  const purgeAt =
    rows === undefined
      ? undefined
      : rows
          .map((row) => row.purgeAt)
          .filter((date): date is string => date !== undefined)
          .sort()
          .at(0)
  return (
    <Item size="md" render={<Link to="/journal/trash" />}>
      <ItemMedia variant="icon" tone="danger">
        <Icon name="trash" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {t('journal.myTrash')}{' '}
          {rows !== undefined && rows.length > 0 && <CountBadge>{rows.length}</CountBadge>}
        </ItemTitle>
        <ItemDescription>
          {purgeAt !== undefined
            ? t('journal.trashPurgeHint', {
                count: rows?.length ?? 0,
                date: entryDay(purgeAt, i18n.language),
              })
            : t('journal.trashHint')}
        </ItemDescription>
      </ItemContent>
      <Icon name="chevron-right" className="text-muted-foreground" />
    </Item>
  )
}
