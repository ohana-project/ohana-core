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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Textarea } from '@/ui/textarea.tsx'
import { toast } from '@/ui/toast.tsx'
import { entryById } from './journal-entries.ts'
import { EntryPhotoEditor } from './journal-photos.tsx'
import { JournalShell } from './journal-shell.tsx'
import {
  ENTRY_TEXT_MAX_LENGTH,
  ENTRY_TITLE_MAX_LENGTH,
  journalErrorMessage,
  useCreateDraft,
  useJournalData,
  usePublishEntry,
  useUpdateEntry,
} from './use-journal.ts'

/*
 * The entry editor (docs/design/screens/diary-editor.html): a new entry
 * starts as a draft — only the author sees it until they publish (issue
 * #15), and a published entry keeps its state through the edit. The
 * mutations go to the API; the screens read back through the sync, so the
 * editor returns to the feed instead of patching any cache by hand.
 */
export function JournalEditorScreen({ entryId }: { entryId?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()
  const { snapshot, entries, downloaded } = useJournalData()

  // A publish that fails after the create leaves this editor on the entry
  // it just made: the created id is kept, so a retried submit goes through
  // the author's edit instead of posting a second draft.
  const [createdId, setCreatedId] = useState<string | undefined>(undefined)
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [text, setText] = useState<string | undefined>(undefined)
  // The blank-text error waits for the first edit; the editor's first
  // paint is not an accusation.
  const [textTouched, setTextTouched] = useState(false)

  const existing =
    entryId !== undefined
      ? entryById(entries, entryId)
      : createdId !== undefined
        ? entryById(entries, createdId)
        : undefined
  // The fields start from the stored entry once it is available; after the
  // first keystroke the member's text wins.
  const effectiveTitle = title ?? existing?.title ?? ''
  const effectiveText = text ?? existing?.text ?? ''

  const createDraft = useCreateDraft()
  const updateEntry = useUpdateEntry()
  const publishEntry = usePublishEntry()

  const pending = createDraft.isPending || updateEntry.isPending || publishEntry.isPending
  const textBlank = effectiveText.trim().length === 0

  const me = session.me?.member
  const displayName = me?.displayName ?? me?.name ?? ''
  // The authorship check reads the registry's active id, the same source
  // the entry screen reads; the session probe still names the profile.
  const activeId = getActiveMemberId()
  const mine = existing === undefined || existing.authorId === activeId

  const goBackToFeed = () => void navigate({ to: '/journal' })

  const save = (thenPublish: boolean) => {
    const body = {
      title: effectiveTitle.trim().length > 0 ? effectiveTitle.trim() : undefined,
      text: effectiveText,
    }
    const onError = (error: unknown) => toast(journalErrorMessage(error, t), 'danger')

    const publishSaved = (savedId: string) => {
      publishEntry.mutate(
        { entryId: savedId },
        {
          onSuccess: () => {
            toast(t('journal.publishedToast'))
            goBackToFeed()
          },
          onError,
        },
      )
    }

    const targetId = existing?.id ?? createdId
    if (targetId === undefined) {
      createDraft.mutate(body, {
        onSuccess: (created) => {
          if (thenPublish) {
            setCreatedId(created.id)
            publishSaved(created.id)
          } else {
            toast(t('journal.draftSavedToast'))
            goBackToFeed()
          }
        },
        onError,
      })
      return
    }
    updateEntry.mutate(
      { entryId: targetId, ...body },
      {
        onSuccess: () => {
          if (thenPublish && (existing?.state ?? 'draft') === 'draft') {
            publishSaved(targetId)
          } else {
            toast(t('journal.savedToast'))
            goBackToFeed()
          }
        },
        onError,
      },
    )
  }

  const editingDraft = existing === undefined || existing.state === 'draft'

  // The photos attach to an entry (issue #17): on a pick from a not-yet-
  // saved entry, the draft is created first — the same move the editor's
  // publish-after-create makes — and the photos go to it. A blank text has
  // no draft to hold them, and the field below says so.
  const ensureEntryForPhotos = async (): Promise<string | null> => {
    const targetId = existing?.id ?? createdId
    if (targetId !== undefined) return targetId
    if (effectiveText.trim().length === 0) {
      setTextTouched(true)
      toast(t('journal.textRequired'), 'danger')
      return null
    }
    return new Promise<string | null>((resolve) => {
      createDraft.mutate(
        {
          title: effectiveTitle.trim().length > 0 ? effectiveTitle.trim() : undefined,
          text: effectiveText,
        },
        {
          onSuccess: (created) => {
            setCreatedId(created.id)
            resolve(created.id)
          },
          onError: () => resolve(null),
        },
      )
    })
  }

  return (
    <JournalShell
      title={existing === undefined ? t('journal.editorNewTitle') : t('journal.editorEditTitle')}
      backTo="/journal"
      width="narrow"
    >
      <div className="flex flex-col gap-5 pt-6 pb-8">
        {entryId !== undefined && snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : entryId !== undefined && existing === undefined ? (
          !downloaded ? (
            // Nothing is downloaded: the entry may exist, this device
            // cannot say (ADR-0002).
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="cloud-off" />
                </EmptyMedia>
                <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
                <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
              </Empty>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">{t('journal.errors.entry_not_found')}</p>
          )
        ) : existing !== undefined && !mine ? (
          // The author edits in any state; everyone else is refused before
          // typing into a form the API would turn away.
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="lock" />
              </EmptyMedia>
              <EmptyTitle>{t('journal.errors.author_required')}</EmptyTitle>
            </Empty>
          </Card>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Avatar hue={hueFromId(activeId ?? '')}>
                <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">
                  {t('journal.publishingAs', {
                    name: displayName,
                    space: session.me?.space.name ?? '',
                  })}
                </span>
                <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
                  {editingDraft ? t('journal.editorDraftBadge') : t('journal.editorPublishedBadge')}
                </span>
              </div>
              {existing?.state === 'draft' && (
                <Badge variant="warn">{t('journal.draftBadge')}</Badge>
              )}
            </div>

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="journal-entry-title">{t('journal.titleField')}</FieldLabel>
                <Input
                  id="journal-entry-title"
                  value={effectiveTitle}
                  maxLength={ENTRY_TITLE_MAX_LENGTH}
                  placeholder={t('journal.editorTitlePlaceholder')}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Field>
              <Field data-invalid={(textTouched && textBlank) || undefined}>
                <FieldLabel htmlFor="journal-entry-text">{t('journal.textField')}</FieldLabel>
                <Textarea
                  id="journal-entry-text"
                  value={effectiveText}
                  rows={10}
                  maxLength={ENTRY_TEXT_MAX_LENGTH}
                  placeholder={t('journal.editorTextPlaceholder')}
                  onChange={(event) => {
                    setTextTouched(true)
                    setText(event.target.value)
                  }}
                  aria-describedby={
                    textTouched && textBlank ? 'journal-entry-text-error' : undefined
                  }
                  aria-invalid={(textTouched && textBlank) || undefined}
                />
                {textTouched && textBlank ? (
                  <FieldError id="journal-entry-text-error">{t('journal.textRequired')}</FieldError>
                ) : (
                  <FieldDescription>{t('journal.textFieldHint')}</FieldDescription>
                )}
              </Field>
            </FieldGroup>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {editingDraft && (
                <Button
                  variant="secondary"
                  disabled={pending || textBlank}
                  onClick={() => save(false)}
                >
                  <Icon name="file-text" />
                  {t('journal.saveDraft')}
                </Button>
              )}
              <Button
                disabled={pending || textBlank}
                onClick={() => save(existing?.state !== 'published')}
              >
                {pending ? <Spinner /> : <Icon name="send" />}
                {existing?.state === 'published' ? t('journal.save') : t('journal.publish')}
              </Button>
            </div>

            {/* The photos (docs/design/screens/diary-editor.html): chips,
                the add tile, and the «N из 12» counter. The author edits
                their entry in any state (CONTEXT.md, published entry) —
                photos included — so the section stays. */}
            <EntryPhotoEditor
              entryId={existing?.id ?? createdId}
              images={existing?.images ?? []}
              onNeedEntry={ensureEntryForPhotos}
            />
          </>
        )}
      </div>
    </JournalShell>
  )
}
