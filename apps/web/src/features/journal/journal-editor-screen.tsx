import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Textarea } from '@/ui/textarea.tsx'
import { toast } from '@/ui/toast.tsx'
import { entryById } from './journal-entries.ts'
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
  const { snapshot, entries } = useJournalData()

  const existing = entryId === undefined ? undefined : entryById(entries, entryId)
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [text, setText] = useState<string | undefined>(undefined)
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

    if (existing === undefined) {
      createDraft.mutate(body, {
        onSuccess: (created) => {
          if (thenPublish) {
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
      { entryId: existing.id, ...body },
      {
        onSuccess: () => {
          if (thenPublish && existing.state === 'draft') {
            publishSaved(existing.id)
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

  return (
    <JournalShell
      title={existing === undefined ? t('journal.editorNewTitle') : t('journal.editorEditTitle')}
      backTo="/journal"
      width="narrow"
    >
      <div className="flex flex-col gap-5 pt-6 pb-8">
        <div className="flex items-center gap-3">
          <Avatar hue={hueFromId(me?.id ?? '')}>
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
          {existing?.state === 'draft' && <Badge variant="warn">{t('journal.draftBadge')}</Badge>}
        </div>

        {entryId !== undefined && snapshot.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : entryId !== undefined && existing === undefined ? (
          <p className="text-sm text-muted-foreground">{t('journal.errors.entry_not_found')}</p>
        ) : (
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
            <Field data-invalid={textBlank || undefined}>
              <FieldLabel htmlFor="journal-entry-text">{t('journal.textField')}</FieldLabel>
              <Textarea
                id="journal-entry-text"
                value={effectiveText}
                rows={10}
                maxLength={ENTRY_TEXT_MAX_LENGTH}
                placeholder={t('journal.editorTextPlaceholder')}
                onChange={(event) => setText(event.target.value)}
                aria-describedby={textBlank ? 'journal-entry-text-error' : undefined}
                aria-invalid={textBlank || undefined}
              />
              {textBlank ? (
                <FieldError id="journal-entry-text-error">{t('journal.textRequired')}</FieldError>
              ) : (
                <FieldDescription>{t('journal.textFieldHint')}</FieldDescription>
              )}
            </Field>
          </FieldGroup>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {editingDraft && (
            <Button variant="secondary" disabled={pending || textBlank} onClick={() => save(false)}>
              <Icon name="file-text" />
              {t('journal.saveDraft')}
            </Button>
          )}
          <Button
            disabled={pending || textBlank}
            onClick={() => save(existing?.state !== 'published')}
          >
            {pending ? <Spinner className="size-4" /> : <Icon name="send" />}
            {existing?.state === 'published' ? t('journal.save') : t('journal.publish')}
          </Button>
        </div>
      </div>
    </JournalShell>
  )
}
