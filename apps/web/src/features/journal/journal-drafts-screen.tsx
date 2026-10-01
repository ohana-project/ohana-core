import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
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
 * only the author sees (issue #15). A draft continues in the editor or
 * shares with the space from here; the trash arrives with its own ticket
 * (#16). The list reads the synchronised partition, so it answers offline
 * exactly as online (ADR-0002).
 */
export function JournalDraftsScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, entries } = useJournalData()
  const drafts = journalDrafts(entries)
  const publish = usePublishEntry()

  return (
    <JournalShell title={t('journal.draftsTitle')} backTo="/journal" width="narrow">
      <div className="flex flex-col gap-3 pt-6">
        <header className="mb-1.5">
          <h1 className="text-display-lg">{t('journal.draftsTitle')}</h1>
          <p className="mt-1 text-muted-foreground">{t('journal.draftsSubtitle')}</p>
        </header>

        {snapshot.isPending ? null : drafts.length === 0 ? (
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
                    void navigate({ to: '/journal/$entryId/edit', params: { entryId: draft.id } })
                  }
                  onPublish={() =>
                    publish.mutate(
                      { entryId: draft.id },
                      {
                        onSuccess: () => toast(t('journal.publishedToast')),
                        onError: (error) => toast(journalErrorMessage(error, t), 'danger'),
                      },
                    )
                  }
                  publishPending={publish.isPending && publish.variables?.entryId === draft.id}
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
  onPublish,
  publishPending,
}: {
  draft: StoredJournalEntry
  locale: string
  onEdit: () => void
  onPublish: () => void
  publishPending: boolean
}) {
  const { t } = useTranslation()
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
        <Button variant="ghost" size="sm" onClick={onPublish} disabled={publishPending}>
          <Icon name="send" />
          {t('journal.publish')}
        </Button>
      </ItemActions>
    </Item>
  )
}
