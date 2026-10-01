import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
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
import { toast } from '@/ui/toast.tsx'
import { entryExcerpt, entryMoment, journalDrafts } from './journal-entries.ts'
import { JournalShell } from './journal-shell.tsx'
import { journalErrorMessage, useJournalData, usePublishEntry } from './use-journal.ts'

/*
 * The author's drafts (docs/design/screens/drafts.html): the separate list
 * only the author sees (issue #15). A draft continues in the editor, and
 * sharing goes through the row's overflow menu — publishing is one-way,
 * so it does not sit a stray tap away, as the prototype puts it. The
 * trash arrives with its own ticket (#16). The list reads the
 * synchronised partition, so it answers offline exactly as online
 * (ADR-0002).
 */
export function JournalDraftsScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, entries, downloaded } = useJournalData()
  const drafts = journalDrafts(entries)

  return (
    <JournalShell title={t('journal.draftsTitle')} backTo="/journal" width="narrow">
      <div className="flex flex-col gap-3 pt-6">
        <header className="mb-1.5">
          <h1 className="text-display-lg">{t('journal.draftsTitle')}</h1>
          <p className="mt-1 text-muted-foreground">{t('journal.draftsSubtitle')}</p>
        </header>

        {snapshot.isPending ? null : !downloaded ? (
          // Nothing is downloaded: "no drafts" would be a claim the device
          // cannot make (ADR-0002).
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="cloud-off" />
              </EmptyMedia>
              <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
              <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
            </Empty>
          </Card>
        ) : drafts.length === 0 ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="file-text" />
              </EmptyMedia>
              <EmptyTitle>{t('journal.draftsEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('journal.draftsEmptyText')}</EmptyDescription>
              <EmptyMedia className="mt-3">
                <Button variant="secondary" onClick={() => void navigate({ to: '/journal/new' })}>
                  <Icon name="plus" />
                  {t('journal.newEntry')}
                </Button>
              </EmptyMedia>
            </Empty>
          </Card>
        ) : (
          <Card className="py-0">
            <ItemGroup>
              {drafts.map((draft) => (
                <DraftRow
                  key={draft.id}
                  draft={draft}
                  locale={i18n.language}
                  onEdit={() =>
                    void navigate({
                      to: '/journal/$entryId/edit',
                      params: { entryId: draft.id },
                    })
                  }
                />
              ))}
            </ItemGroup>
          </Card>
        )}

        <p className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
          <Icon name="lock" className="size-[15px] shrink-0" />
          {t('journal.draftsPrivacyNote')}
        </p>
      </div>
    </JournalShell>
  )
}

function DraftRow({
  draft,
  locale,
  onEdit,
}: {
  draft: StoredJournalEntry
  locale: string
  onEdit: () => void
}) {
  const { t } = useTranslation()
  // Each row owns its mutation: one publish in flight must not re-enable
  // another row's button or drop its toast.
  const publish = usePublishEntry()
  return (
    <Item size="lg">
      <ItemMedia>
        <Icon name="file-text" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{draft.title ?? entryExcerpt(draft.text, 60)}</ItemTitle>
        <ItemDescription>
          {t('journal.draftEditedAt', {
            moment: entryMoment(draft.updatedAt, locale),
          })}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          {t('journal.continueEditing')}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label={t('journal.draftActions')} />}
          >
            <Icon name="more-h" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={publish.isPending || publish.isSuccess}
              onClick={() =>
                publish.mutate(
                  { entryId: draft.id },
                  {
                    onSuccess: () => toast(t('journal.publishedToast')),
                    onError: (error) => toast(journalErrorMessage(error, t), 'danger'),
                  },
                )
              }
            >
              <Icon name="send" />
              {t('journal.publishNow')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>
    </Item>
  )
}
