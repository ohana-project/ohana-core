import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { ActionBar } from '@/ui/action-bar.tsx'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { FieldError } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Separator } from '@/ui/separator.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { entryById, entryTime } from './journal-entries.ts'
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
 *
 * The page is the prototype's (issue #71): the borderless serif title and
 * the 16px/1.65 body with their labels kept for assistive technology, the
 * rule between them, the photo grid with its dashed attach tile — and the
 * save pair riding the top bar from 920px up and the shared action bar
 * below it, instead of buttons inline in the content.
 */
export function JournalEditorScreen({ entryId }: { entryId?: string }) {
  const { t, i18n } = useTranslation()
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
  // The primary's word: a draft publishes, a published entry just saves —
  // the state has no way back to draft (CONTEXT.md, published entry).
  const primaryLabel = existing?.state === 'published' ? t('journal.save') : t('journal.publish')
  const primaryNeedsPublish = existing?.state !== 'published'

  // The saved moment the prototype's «СОХРАНЕНО 19:02» shows: the stored
  // entry's own last edit. A brand-new entry has none — the indicator
  // stays absent rather than pretending (docs/design/README.md).
  const savedTime = existing !== undefined ? entryTime(existing.updatedAt, i18n.language) : undefined
  // The prototype's «ФОТО: 2 · СИМВОЛОВ: 342» line over the live data.
  const photoCount = existing?.images?.length ?? 0
  const charCount = Array.from(effectiveText).length

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

  // The form (and with it the two action carriers) mounts only where the
  // member can actually edit: none of the loading, offline, not-found and
  // refused states carries a save.
  const formReady =
    !(entryId !== undefined && snapshot.isPending) &&
    !(entryId !== undefined && existing === undefined) &&
    !(existing !== undefined && !mine)

  return (
    <JournalShell
      title={existing === undefined ? t('journal.editorNewTitle') : t('journal.editorEditTitle')}
      backTo="/journal"
      width="narrow"
      desktopActions={
        formReady ? (
          <>
            {/* the prototype's top-bar template (diary-editor.html): the
                meta line, then the small pair. The «ЧЕРНОВИК
                АВТОСОХРАНЁН» the prototype names is an autosave the app
                does not have — the line reads the stored edit's own
                moment, and the photo/character counts ride beside it
                (docs/design/README.md, the journal editor). */}
            {savedTime !== undefined && (
              <span className="min-w-0 truncate font-mono text-[13px] tracking-wide text-muted-foreground uppercase">
                {t('journal.savedAt', { time: savedTime })}
              </span>
            )}
            <span className="min-w-0 truncate font-mono text-[13px] tracking-wide text-muted-foreground uppercase">
              {t('journal.photoCharCounter', { photos: photoCount, chars: charCount })}
            </span>
            {editingDraft && (
              <Button
                variant="secondary"
                size="sm"
                disabled={pending || textBlank}
                onClick={() => save(false)}
              >
                {/* the prototype's 16px glyphs on the top-bar pair */}
                <Icon name="file-text" className="size-4" />
                {t('journal.saveDraft')}
              </Button>
            )}
            <Button size="sm" disabled={pending || textBlank} onClick={() => save(primaryNeedsPublish)}>
              {pending ? <Spinner className="size-4" /> : <Icon name="send" className="size-4" />}
              {primaryLabel}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 pt-6.5">
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
            {/* the prototype's author row: the avatar, the «Аня публикует
                в …» line, the day — the status word where the prototype's
                «СЕГОДНЯ» stands, an entry being edited already having its
                state said */}
            <div className="flex items-start gap-3">
              <Avatar hue={hueFromId(activeId ?? '')}>
                <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col pt-1.5">
                <span className="text-sm font-semibold">
                  {t('journal.publishingAs', {
                    name: displayName,
                    space: session.me?.space.name ?? '',
                  })}
                </span>
                <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
                  {existing === undefined
                    ? t('journal.editorToday')
                    : existing.state === 'draft'
                      ? t('journal.editorDraftBadge')
                      : t('journal.editorPublishedBadge')}
                </span>
              </div>
            </div>

            {/* the prototype's fields: the borderless 24px serif title and
                the 16px/1.65 body, labels kept for assistive technology */}
            <label className="sr-only" htmlFor="journal-entry-title">
              {t('journal.titleField')}
            </label>
            <input
              id="journal-entry-title"
              type="text"
              value={effectiveTitle}
              maxLength={ENTRY_TITLE_MAX_LENGTH}
              placeholder={t('journal.editorTitlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
              className="w-full border-0 bg-transparent p-0 font-display text-h1 placeholder:text-[color-mix(in_oklch,var(--muted)_55%,transparent)] focus-visible:outline-offset-4"
            />
            {/* the prototype's rule between the title and the text */}
            <Separator />
            <label className="sr-only" htmlFor="journal-entry-text">
              {t('journal.textField')}
            </label>
            <textarea
              id="journal-entry-text"
              value={effectiveText}
              maxLength={ENTRY_TEXT_MAX_LENGTH}
              placeholder={t('journal.editorTextPlaceholder')}
              onChange={(event) => {
                setTextTouched(true)
                setText(event.target.value)
              }}
              aria-invalid={(textTouched && textBlank) || undefined}
              aria-describedby={
                textTouched && textBlank ? 'journal-entry-text-error' : undefined
              }
              className="min-h-[200px] w-full resize-none border-0 bg-transparent p-0 text-[16px] leading-[1.65] placeholder:text-[color-mix(in_oklch,var(--muted)_55%,transparent)] focus-visible:outline-offset-4"
            />
            {textTouched && textBlank ? (
              <FieldError id="journal-entry-text-error">{t('journal.textRequired')}</FieldError>
            ) : null}

            {/* The photos (docs/design/screens/diary-editor.html): chips,
                the add tile, and the «N из 12» counter. The author edits
                their entry in any state (CONTEXT.md, published entry) —
                photos included — so the section stays. */}
            <EntryPhotoEditor
              entryId={existing?.id ?? createdId}
              images={existing?.images ?? []}
              onNeedEntry={ensureEntryForPhotos}
            />

            {/* The prototype's `.editor-bar` (issue #61): the same pair
                below 920px, fixed above the tab bar; the member layout
                reserves its room while it is up. The bar's meta carries
                the saved moment where the prototype's does, going sr-only
                below 420px the way the sync chip's text does. */}
            <ActionBar>
              {savedTime !== undefined && (
                <span className="min-w-0 grow truncate font-mono text-[13px] tracking-wide text-muted-foreground uppercase [@media(max-width:419.98px)]:sr-only">
                  {t('journal.savedAt', { time: savedTime })}
                </span>
              )}
              {editingDraft && (
                <Button
                  variant="secondary"
                  className="min-w-0 px-3"
                  disabled={pending || textBlank}
                  onClick={() => save(false)}
                >
                  {t('journal.toDrafts')}
                </Button>
              )}
              <Button
                className="min-w-0 flex-1 px-4.5"
                disabled={pending || textBlank}
                onClick={() => save(primaryNeedsPublish)}
              >
                {pending ? <Spinner className="size-4" /> : null}
                {primaryLabel}
              </Button>
            </ActionBar>
          </>
        )}
      </div>
    </JournalShell>
  )
}
