import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import type { TrashedEntryDto } from '@/features/journal/use-journal.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { cn } from '@/lib/cn'
import { Banner } from '@/ui/banner.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Icon } from '@/ui/icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/ui/item.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { entryDay, entryExcerpt } from './journal-entries.ts'
import { JournalShell } from './journal-shell.tsx'
import { journalErrorMessage, useRestoreEntry, useTrash } from './use-journal.ts'

/*
 * The trash (docs/design/screens/trash.html, issue #16): the trashed
 * entries this member may see, each naming the moment it leaves for good,
 * with restore one tap away. The rows are online-only — a trashed entry
 * has left every device's synchronised partition, so this view asks the
 * server — and restoring puts the entry back into the synchronised one,
 * whose upsert the next sync delivers to the screens that read it. The
 * screen matches the prototype's anatomy (issue #72): one card per row in
 * the 12px stack, the banner closing it, the empty state bare.
 */

/** The prototype's exit (trash.html): a 250ms fade, the row removed at 260ms. */
const RESTORE_FADE_MS = 260

/** A restored row held in place while its fade runs (see `ghosts`). */
interface RestoredGhost {
  row: TrashedEntryDto
  index: number
}

export function JournalTrashScreen() {
  const { t, i18n } = useTranslation()
  const trash = useTrash()
  const session = useMemberSessionStatus()
  const serverRows = trash.data?.entries ?? []
  // A restored row fades out where it stood (issue #72): the ghost keeps
  // it mounted at its place for the fade's span — the refetch the restore
  // triggered may drop it from the data at any moment, and the list must
  // not close over it before the fade has run.
  const [ghosts, setGhosts] = useState<RestoredGhost[]>([])

  const startFade = (row: TrashedEntryDto) => {
    setGhosts((prev) => [
      ...prev,
      { row, index: serverRows.findIndex((candidate) => candidate.id === row.id) },
    ])
    window.setTimeout(() => {
      setGhosts((prev) => prev.filter((ghost) => ghost.row.id !== row.id))
    }, RESTORE_FADE_MS)
  }

  // The live rows, then each ghost back at the place it stood — clamped,
  // in order, so a fade never moves the rows around it.
  const liveRows = serverRows.filter((row) => !ghosts.some((ghost) => ghost.row.id === row.id))
  const rows: Array<{ row: TrashedEntryDto; exiting: boolean }> = liveRows.map((row) => ({
    row,
    exiting: false,
  }))
  for (const ghost of [...ghosts].sort((a, b) => a.index - b.index)) {
    rows.splice(Math.min(Math.max(ghost.index, 0), rows.length), 0, {
      row: ghost.row,
      exiting: true,
    })
  }

  return (
    <JournalShell title={t('journal.trashTitle')} backTo="/journal" width="narrow">
      <div className="flex flex-col gap-3 pt-6">
        <header className="mb-1.5">
          <h1 className="text-display">{t('journal.trashTitle')}</h1>
          <p className="mt-1.5 text-muted-foreground">{t('journal.trashSubtitle')}</p>
        </header>

        {trash.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : trash.isError ? (
          <ErrorState onRetry={() => void trash.refetch()} />
        ) : rows.length === 0 ? (
          // The prototype's empty state stands bare — no card around it.
          <Empty>
            <EmptyMedia>
              <Icon name="trash" />
            </EmptyMedia>
            <EmptyTitle>{t('journal.trashEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('journal.trashEmptyText')}</EmptyDescription>
          </Empty>
        ) : (
          <>
            {/* One list card per row (trash.html): each card clips its
                own row's corners, the 12px stack spacing them, and the
                banner closes the same stack — the prototype's 16px margin
                under it (`.content .banner`). */}
            {rows.map(({ row, exiting }) => (
              <TrashRow
                key={row.id}
                row={row}
                locale={i18n.language}
                exiting={exiting}
                restorable={
                  row.authorId === getActiveMemberId() ||
                  (session.me?.member.role === 'owner' && row.previousState === 'published')
                }
                onRestored={startFade}
              />
            ))}
            <Banner icon="info" className="mb-4">
              {t('journal.trashNote')}
            </Banner>
          </>
        )}
      </div>
    </JournalShell>
  )
}

function TrashRow({
  row,
  locale,
  restorable,
  exiting = false,
  onRestored,
}: {
  row: TrashedEntryDto
  locale: string
  restorable: boolean
  exiting?: boolean
  onRestored?: (row: TrashedEntryDto) => void
}) {
  const { t } = useTranslation()
  // Each row owns its mutation: one restore in flight must not re-enable
  // another row's button or drop its toast.
  const restore = useRestoreEntry()

  return (
    // The exit is the prototype's own (trash.html): opacity and a 6px
    // drop over the base motion, the card inert so a fading row takes no
    // taps and no focus while it goes.
    <Card
      variant="list"
      aria-hidden={exiting || undefined}
      inert={exiting}
      className={cn(
        'transition-[opacity,transform] duration-(--t-base) ease-(--ease)',
        exiting && 'pointer-events-none opacity-0 translate-y-1.5',
      )}
    >
      <Item size="lg">
        <ItemMedia variant="icon">
          <Icon name={row.previousState === 'published' ? 'book' : 'file-text'} />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{row.title ?? entryExcerpt(row.text, 60)}</ItemTitle>
          <ItemDescription>
            {t('journal.trashRowMeta', {
              deleted: entryDay(row.trashedAt, locale),
              purgeAt: entryDay(row.purgeAt, locale),
            })}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {restorable ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={restore.isPending}
              onClick={() =>
                restore.mutate(
                  { entryId: row.id },
                  {
                    onSuccess: () => {
                      toast(t('journal.restoredToast'))
                      onRestored?.(row)
                    },
                    onError: (error) => toast(journalErrorMessage(error, t), 'danger'),
                  },
                )
              }
            >
              {t('journal.restore')}
            </Button>
          ) : null}
        </ItemActions>
      </Item>
    </Card>
  )
}
