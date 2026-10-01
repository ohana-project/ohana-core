import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import type { TrashedEntryDto } from '@/features/journal/use-journal.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
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
  ItemGroup,
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
 * whose upsert the next sync delivers to the screens that read it.
 */

export function JournalTrashScreen() {
  const { t, i18n } = useTranslation()
  const trash = useTrash()
  const session = useMemberSessionStatus()

  return (
    <JournalShell title={t('journal.trashTitle')} backTo="/journal" width="narrow">
      <div className="flex flex-col gap-3 pt-6">
        <header className="mb-1.5">
          <h1 className="text-display-lg">{t('journal.trashTitle')}</h1>
          <p className="mt-1 text-muted-foreground">{t('journal.trashSubtitle')}</p>
        </header>

        {trash.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : trash.isError ? (
          <ErrorState onRetry={() => void trash.refetch()} />
        ) : trash.data.entries.length === 0 ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="trash" />
              </EmptyMedia>
              <EmptyTitle>{t('journal.trashEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('journal.trashEmptyText')}</EmptyDescription>
            </Empty>
          </Card>
        ) : (
          <>
            <Card className="py-0">
              <ItemGroup>
                {trash.data.entries.map((row) => (
                  <TrashRow
                    key={row.id}
                    row={row}
                    locale={i18n.language}
                    restorable={
                      row.authorId === getActiveMemberId() ||
                      (session.me?.member.role === 'owner' && row.previousState === 'published')
                    }
                  />
                ))}
              </ItemGroup>
            </Card>
            <Banner icon="info">{t('journal.trashNote')}</Banner>
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
}: {
  row: TrashedEntryDto
  locale: string
  restorable: boolean
}) {
  const { t } = useTranslation()
  // Each row owns its mutation: one restore in flight must not re-enable
  // another row's button or drop its toast.
  const restore = useRestoreEntry()

  return (
    <Item size="lg">
      <ItemMedia>
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
                  onSuccess: () => toast(t('journal.restoredToast')),
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
  )
}
