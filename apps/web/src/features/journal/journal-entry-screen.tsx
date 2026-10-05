import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import {
  authorName,
  entryById,
  entryDay,
  entryExcerpt,
  entryMoment,
  entryTimestamp,
} from './journal-entries.ts'
import { EntryPhotoGallery } from './journal-photos.tsx'
import { JournalShell } from './journal-shell.tsx'
import { journalErrorMessage, useJournalData, useTrashEntry } from './use-journal.ts'

/*
 * One entry (docs/design/screens/diary-entry.html): the author's name and
 * the moment it was shared, the title, and the text. A draft carries its
 * badge and is opened by its author alone — the server never delivered it
 * to anyone else. Photos arrive with their own ticket (#17). The overflow
 * menu carries the removal (issue #16): one tap must not trash a shared
 * entry for good, so the dialog stands between, and the toast names the
 * date the answer computed.
 */
export function JournalEntryScreen({ entryId }: { entryId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, entries, profiles, downloaded } = useJournalData()
  const session = useMemberSessionStatus()
  const [confirmTrash, setConfirmTrash] = useState(false)
  // The screen owns the mutation: the menu opens the dialog, the dialog's
  // confirm sends it, and the toast names the deletion date the answer
  // computed from the instance's retention.
  const trash = useTrashEntry()

  const entry = entryById(entries, entryId)
  const author = entry
    ? authorName(entry.authorId, profiles, t('journal.authorUnknown'))
    : undefined
  const mine = entry !== undefined && entry.authorId === getActiveMemberId()
  const canTrash =
    entry !== undefined &&
    (mine || (session.me?.member.role === 'owner' && entry.state === 'published'))

  const removeEntry = () => {
    trash.mutate(
      { entryId },
      {
        onSuccess: (trashed) => {
          setConfirmTrash(false)
          toast(t('journal.trashedToast', { date: entryDay(trashed.purgeAt, i18n.language) }))
          void navigate({ to: '/journal' })
        },
        onError: (error) => {
          setConfirmTrash(false)
          toast(journalErrorMessage(error, t), 'danger')
        },
      },
    )
  }

  return (
    <JournalShell title={t('journal.entryTitle')} backTo="/journal" width="narrow">
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : entry === undefined || author === undefined ? (
        // A missing entry waits for the replay while one is owed — "no such
        // entry" would be a claim the device cannot make (ADR-0014).
        !downloaded ? (
          <Card className="mt-6">
            <Empty>
              <EmptyMedia>
                <Icon name="cloud-off" />
              </EmptyMedia>
              <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
              <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
            </Empty>
          </Card>
        ) : (
          <Card className="mt-6">
            <Empty>
              <EmptyMedia>
                <Icon name="file-text" />
              </EmptyMedia>
              <EmptyTitle>{t('journal.entryMissingTitle')}</EmptyTitle>
              <EmptyDescription>{t('journal.entryMissingText')}</EmptyDescription>
            </Empty>
          </Card>
        )
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
              {(entry.images?.length ?? 0) > 0 && (
                <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
                  {t('journal.photosPill', { count: entry.images?.length ?? 0 })}
                </span>
              )}
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
              {canTrash && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon" aria-label={t('journal.deleteEntry')} />
                    }
                  >
                    <Icon name="more-h" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem variant="destructive" onClick={() => setConfirmTrash(true)}>
                      <Icon name="trash" />
                      {t('journal.deleteEntry')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
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

          {/* The entry's gallery (docs/design/screens/diary-entry.html): the
              worker's previews in the grid, the lightbox on the viewer
              derivative that upgrades to the original (issue #17). */}
          <EntryPhotoGallery entry={entry} />
        </article>
      )}

      {confirmTrash && entry !== undefined ? (
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
                  name: entry.title ?? entryExcerpt(entry.text, 40),
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
              <Button variant="destructive" disabled={trash.isPending} onClick={removeEntry}>
                {t('journal.trashConfirmLabel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </JournalShell>
  )
}
