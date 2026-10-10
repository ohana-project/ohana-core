import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { writeClipboard } from '@/lib/clipboard.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button, buttonVariants } from '@/ui/button.tsx'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Separator } from '@/ui/separator.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import {
  authorName,
  entryById,
  entryDay,
  entryExcerpt,
  entryMoment,
  entryTimestamp,
  nextEntryInFeed,
} from './journal-entries.ts'
import { EntryPhotoGallery } from './journal-photos.tsx'
import { JournalShell } from './journal-shell.tsx'
import { journalErrorMessage, useJournalData, useTrashEntry } from './use-journal.ts'

/*
 * One entry (docs/design/screens/diary-entry.html): the author's 40px
 * avatar and the moment it was shared, the photo count as the neutral
 * pill, the display-size title, the text at the prototype's own
 * 16px/1.65, the three-column photo grid, and the footer — the rule,
 * «Все записи» and the next entry of the feed. The screen's actions live
 * in the top bar's overflow menu at every width (the prototype's
 * `data-topbar-actions` button carries no `d-only` here): the prototype's
 * Share, Copy link, separator and Delete — with the author's edit riding
 * the menu's first group, because the prototype offers no edit on this
 * screen and the editor must stay reachable (README, issue #70). The
 * menu opens the removal dialog; one tap must not trash a shared entry
 * for good, and the toast names the date the answer computed.
 */

/** The absolute link a share or a copy hands on: the entry's own address. */
function entryUrl(entryId: string): string {
  return new URL(`/journal/${entryId}`, window.location.origin).toString()
}

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
  const next = nextEntryInFeed(entries, entryId)

  // «Поделиться…» opens the platform's share sheet where there is one;
  // where there is not — or it refuses — the link lands on the clipboard,
  // the same place «Скопировать ссылку» puts it, so the tap always ends
  // with the link in someone's hands.
  const shareEntry = async () => {
    const url = entryUrl(entryId)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: entry?.title ?? undefined, url })
        return
      } catch (cause) {
        // The user's own cancel is not a failure; anything else — an
        // unavailable sheet behind the feature check, a refusal — falls
        // through to the clipboard below.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
      }
    }
    await copyEntryLink()
  }

  const copyEntryLink = async () => {
    if (await writeClipboard(entryUrl(entryId))) {
      toast(t('journal.linkCopiedToast'))
    } else {
      toast(t('journal.errors.unexpected'), 'danger')
    }
  }

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

  const entryMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={t('journal.entryMenu')} />}
      >
        <Icon name="more-h" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {mine && (
          <DropdownMenuItem
            onClick={() => void navigate({ to: '/journal/$entryId/edit', params: { entryId } })}
          >
            <Icon name="edit" />
            {t('journal.edit')}
          </DropdownMenuItem>
        )}
        {mine && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => void shareEntry()}>
          <Icon name="share" />
          {t('journal.shareEntry')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copyEntryLink()}>
          <Icon name="copy" />
          {t('journal.copyLink')}
        </DropdownMenuItem>
        {canTrash && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmTrash(true)}>
              <Icon name="trash" />
              {t('journal.deleteEntry')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <JournalShell
      title={t('journal.entryTitle')}
      backTo="/journal"
      width="narrow"
      actions={entryMenu}
    >
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
        <article className="flex flex-col pt-7">
          <header>
            {/* the prototype's .entry-meta, 14px above the title */}
            <div className="mb-3.5 flex items-center gap-2.5">
              <Avatar hue={hueFromId(entry.authorId)}>
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
                <Badge variant="neutral">
                  {t('journal.photosPill', { count: entry.images?.length ?? 0 })}
                </Badge>
              )}
            </div>
            {entry.title !== undefined && <h1 className="mb-4 text-display">{entry.title}</h1>}
          </header>

          {/* the prototype's own entry text: 16px over 1.65 */}
          <div className="flex flex-col gap-4 text-[16px] leading-[1.65]">
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

          {/* the footer (docs/design/screens/diary-entry.html): the rule
              26/14, «Все записи» and the next entry of the feed */}
          <footer>
            <Separator className="mt-[26px] mb-3.5" />
            <div className="flex items-center justify-between gap-3">
              <Link to="/journal" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                <Icon name="chevron-left" className="size-4" />
                {t('journal.allEntries')}
              </Link>
              {next !== undefined && (
                <span className="truncate font-mono text-meta tracking-wide text-muted-foreground uppercase">
                  {t('journal.nextEntry', {
                    title: next.title ?? entryExcerpt(next.text, 40),
                  })}
                </span>
              )}
            </div>
          </footer>
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
