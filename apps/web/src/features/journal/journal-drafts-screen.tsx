import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredJournalEntry } from '@/data/local-store.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@/ui/item.tsx'
import { toast } from '@/ui/toast.tsx'
import { entryDay, entryExcerpt, entryMoment, journalDrafts } from './journal-entries.ts'
import { JournalShell } from './journal-shell.tsx'
import {
  journalErrorMessage,
  useJournalData,
  usePublishEntry,
  useTrashEntry,
} from './use-journal.ts'

/*
 * The author's drafts (docs/design/screens/drafts.html): the separate list
 * only the author sees (issue #15), one card per row in the prototype's
 * 12px stack (issue #72). A draft continues in the editor — the row body
 * is the prototype's `a.body` link, beside the small «Дописать» — and
 * sharing goes through the row's overflow menu — publishing is one-way,
 * so it does not sit a stray tap away, as the prototype puts it. The
 * removal goes through the same menu with a dialog between (issue #16):
 * drafts land in the trash like any entry — ADR-0007 gives the author the
 * same recovery window, and the trashed draft stays visible only to its
 * author. The list reads the synchronised partition, so it answers
 * offline exactly as online (ADR-0002).
 */
export function JournalDraftsScreen() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, entries, downloaded } = useJournalData()
  const drafts = journalDrafts(entries)

  return (
    // The prototype's data-title names the screen short — «Черновики» —
    // where the content heading keeps its full words (issue #72).
    <JournalShell title={t('journal.draftsTopBarTitle')} backTo="/journal" width="narrow">
      <div className="flex flex-col gap-3 pt-6">
        <header className="mb-1.5">
          <h1 className="text-display">{t('journal.draftsTitle')}</h1>
          <p className="mt-1.5 text-muted-foreground">{t('journal.draftsSubtitle')}</p>
        </header>

        {snapshot.isPending ? null : !downloaded ? (
          // Nothing is downloaded: "no drafts" would be a claim the device
          // cannot make (ADR-0002). The empty state stands bare (README
          // "Cards") — no card around it.
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        ) : drafts.length === 0 ? (
          // The prototype's empty state stands bare, its «Новая запись»
          // secondary below the text without an icon (issue #72).
          <Empty>
            <EmptyMedia>
              <Icon name="file-text" />
            </EmptyMedia>
            <EmptyTitle>{t('journal.draftsEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('journal.draftsEmptyText')}</EmptyDescription>
            <EmptyContent>
              <Button variant="secondary" onClick={() => void navigate({ to: '/journal/new' })}>
                {t('journal.newEntry')}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            {/* One list card per draft (drafts.html): each card clips its
                own row's corners, the 12px stack spacing them. */}
            {drafts.map((draft) => (
              <Card key={draft.id} variant="list">
                <DraftRow
                  draft={draft}
                  locale={i18n.language}
                  onEdit={() =>
                    void navigate({
                      to: '/journal/$entryId/edit',
                      params: { entryId: draft.id },
                    })
                  }
                />
              </Card>
            ))}
            {/* The lock note rides the list — the prototype keeps it
                inside the stack, so it hides with it (issue #72). */}
            <p className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
              <Icon name="lock" className="shrink-0" />
              {t('journal.draftsPrivacyNote')}
            </p>
          </>
        )}
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
  // Each row owns its mutations: one publish or trash in flight must not
  // re-enable another row's button or drop its toast.
  const publish = usePublishEntry()
  const trash = useTrashEntry()
  const [confirmTrash, setConfirmTrash] = useState(false)
  return (
    <Item size="lg">
      <ItemMedia variant="icon">
        <Icon name="file-text" />
      </ItemMedia>
      <ItemContent>
        {/* The row body is the prototype's `a.body`: the whole title and
            sub block opens the editor, the actions stay outside the link
            (issue #72). */}
        <Link
          to="/journal/$entryId/edit"
          params={{ entryId: draft.id }}
          className="flex min-w-0 flex-col gap-px"
        >
          <ItemTitle>{draft.title ?? entryExcerpt(draft.text, 60)}</ItemTitle>
          <ItemDescription>
            {t('journal.draftEditedAt', {
              moment: entryMoment(draft.updatedAt, locale),
            })}
            {/* The prototype's sub counts the draft's photos after the
                edit moment; photos travel inside the entry's DTO, so the
                count is the partition's own (issue #72). */}
            {(draft.images?.length ?? 0) > 0 && (
              <> · {t('journal.draftPhotos', { count: draft.images?.length ?? 0 })}</>
            )}
          </ItemDescription>
        </Link>
      </ItemContent>
      <ItemActions>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          {t('journal.continueEditing')}
        </Button>
        <DropdownMenu>
          {/* The prototype's `.btn-icon.btn-sm`: the 36px round with its
              18px more-h glyph (issue #72). */}
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={t('journal.draftActions')} />
            }
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
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmTrash(true)}>
              <Icon name="trash" />
              {t('journal.deleteDraft')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </ItemActions>

      {confirmTrash ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !trash.isPending) setConfirmTrash(false)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('journal.trashConfirmTitle')}</DialogTitle>
              <DialogDescription>
                {t('journal.trashConfirmText', {
                  name: draft.title ?? entryExcerpt(draft.text, 40),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={trash.isPending}
                onClick={() => setConfirmTrash(false)}
              >
                {t('ui.cancel')}
              </Button>
              <Button
                variant="destructive"
                disabled={trash.isPending}
                onClick={() =>
                  trash.mutate(
                    { entryId: draft.id },
                    {
                      onSuccess: (trashed) => {
                        setConfirmTrash(false)
                        // The trashed draft left the synchronised
                        // partition through its tombstone; the sync the
                        // mutation triggered takes the row off this list.
                        toast(
                          t('journal.trashedToast', {
                            date: entryDay(trashed.purgeAt, locale),
                          }),
                        )
                      },
                      onError: (error) => {
                        setConfirmTrash(false)
                        toast(journalErrorMessage(error, t), 'danger')
                      },
                    },
                  )
                }
              >
                {t('journal.trashConfirmLabel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Item>
  )
}
