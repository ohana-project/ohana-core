import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, extractErrorCode } from '@/data/api-error.ts'
import type { StoredJournalEntry, StoredJournalEntryImage } from '@/data/local-store.ts'
import { triggerSync } from '@/data/sync-engine.ts'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import {
  deleteEntryImage,
  entryImageUrl,
  fetchEntryImage,
  memberHeader,
  uploadEntryImage,
} from './journal-photos.ts'
import { journalErrorMessage } from './use-journal.ts'

/*
 * The journal's photo pieces (issue #17), built from the design system and
 * the reference prototypes (docs/design/screens/diary.html, diary-entry.html,
 * diary-editor.html): a feed card's small strip, the entry's gallery with
 * the lightbox, and the editor's chips. They belong to the feature, not to
 * ui/ — the design README reserves the photo strip, grid, and upload chip
 * for their ticket.
 *
 * The previews are the worker's `feed` derivative — metadata-free WebP the
 * service worker caches as they are viewed; the lightbox opens on the
 * `full` viewer derivative and upgrades to the original when it lands, so
 * the tap is instant and the quality is the uploaded one (ADR-0008).
 */

function useEntryImageUrl(
  entryId: string,
  imageId: string,
  variant: 'feed' | 'full' | 'original',
  enabled = true,
) {
  return useQuery({
    queryKey: ['journal', 'photo', entryId, imageId, variant],
    queryFn: () => fetchEntryImage(entryId, imageId, variant),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
    // A photo the worker has not finished has no bytes to ask for; the
    // state comes through the sync when they exist.
    enabled,
  })
}

function PhotoTile({
  entryId,
  image,
  onOpen,
  alt,
}: {
  entryId: string
  image: StoredJournalEntryImage
  onOpen?: (image: StoredJournalEntryImage) => void
  alt: string
}) {
  const { t } = useTranslation()
  // The bytes are only asked for once the worker has made them.
  const preview = useEntryImageUrl(entryId, image.id, 'feed', image.state === 'ready')
  const aspect = image.width && image.height ? image.width / image.height : 4 / 3

  if (image.state === 'processing') {
    return (
      <div
        className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-muted"
        role="status"
        aria-label={t('journal.photoProcessing')}
      >
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }
  if (image.state === 'failed' || preview.isError) {
    return (
      <div
        className="grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
        role="img"
        aria-label={t('journal.photoFailed')}
      >
        <Icon name="image" className="size-5" />
      </div>
    )
  }
  return (
    <button
      type="button"
      className="block w-full overflow-hidden rounded-lg bg-muted"
      onClick={() => onOpen?.(image)}
      aria-label={alt}
    >
      {preview.data === undefined ? (
        <div className="grid aspect-[4/3] place-items-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      ) : (
        <img
          src={preview.data}
          alt={alt}
          loading="lazy"
          className="h-full w-full object-cover"
          style={{ aspectRatio: `${aspect}` }}
        />
      )}
    </button>
  )
}

/**
 * A feed card's photo strip (docs/design/screens/diary.html, issue #69):
 * full width, 132px tall, 8px gaps, the prototype's medium radius — and a
 * lone photo at 16:10 instead of a sliver. At most three previews: the
 * prototype's demo never exceeds three, the meta row carries the count,
 * and the rest wait on the entry screen's gallery.
 */
export function EntryPhotoStrip({ entry }: { entry: StoredJournalEntry }) {
  const images = entry.images ?? []
  if (images.length === 0) return null
  const shown = images.slice(0, 3)
  return (
    // The prototype's `.photo-strip` under `.entry-card`: margin-top 12px,
    // gap 8px, the images `flex: 1; min-width: 0`.
    <div className="mt-3 flex gap-2">
      {shown.map((image) => (
        <StripPhoto key={image.id} entryId={entry.id} image={image} single={shown.length === 1} />
      ))}
    </div>
  )
}

/**
 * One strip photo. The strip sits inside the card's link, so the photos
 * stay plain images (no nested controls) and decorative — the card's text
 * names the entry, the screen's gallery carries the accessible copies.
 * Every state holds the photo's final geometry, so the strip never jumps
 * while the previews stream in.
 */
function StripPhoto({
  entryId,
  image,
  single,
}: {
  entryId: string
  image: StoredJournalEntryImage
  single: boolean
}) {
  const { t } = useTranslation()
  // The bytes are only asked for once the worker has made them.
  const preview = useEntryImageUrl(entryId, image.id, 'feed', image.state === 'ready')
  const shape = single ? 'aspect-[16/10] w-full flex-none' : 'h-[132px] min-w-0 flex-1'
  if (image.state === 'processing') {
    return (
      <div
        className={`grid ${shape} place-items-center overflow-hidden rounded-md bg-muted`}
        role="status"
        aria-label={t('journal.photoProcessing')}
      >
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }
  if (image.state === 'failed' || preview.isError) {
    return (
      <div
        className={`grid ${shape} place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground`}
        role="img"
        aria-label={t('journal.photoFailed')}
      >
        <Icon name="image" className="size-5" />
      </div>
    )
  }
  if (preview.data === undefined) {
    return <div className={`${shape} rounded-md bg-muted`} aria-hidden="true" />
  }
  return (
    <img
      src={preview.data}
      alt=""
      loading="lazy"
      className={`${shape} self-start overflow-hidden rounded-md object-cover`}
    />
  )
}

/** The entry screen's gallery (docs/design/screens/diary-entry.html) with the
 *  lightbox: a tap opens the photo, Esc and the scrim close it. */
export function EntryPhotoGallery({ entry }: { entry: StoredJournalEntry }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<StoredJournalEntryImage | undefined>(undefined)
  const images = entry.images ?? []
  if (images.length === 0) return null
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 desktop:grid-cols-3">
        {images.map((image) => (
          <PhotoTile
            key={image.id}
            entryId={entry.id}
            image={image}
            onOpen={setOpen}
            alt={t('journal.openOriginalHint')}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-meta tracking-wide text-muted-foreground uppercase">
        {t('journal.openOriginalHint')}
      </p>
      {open !== undefined && (
        <PhotoLightbox entryId={entry.id} image={open} onClose={() => setOpen(undefined)} />
      )}
    </div>
  )
}

/**
 * The originals a browser can show in an <img>. A HEIC or TIFF original —
 * the iPhone's own format — is offered as a download instead: swapping a
 * working viewer image for bytes the browser cannot render would break the
 * viewer exactly on the ticket's headline case.
 */
const RENDERABLE_ORIGINALS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

/** The file extension a non-renderable original downloads under. */
const DOWNLOAD_EXTENSIONS: Record<string, string> = {
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/tiff': 'tiff',
}

function PhotoLightbox({
  entryId,
  image,
  onClose,
}: {
  entryId: string
  image: StoredJournalEntryImage
  onClose: () => void
}) {
  const { t } = useTranslation()
  const viewer = useEntryImageUrl(entryId, image.id, 'full')
  // The original is fetched only where a browser can show it: a HEIC
  // original is up to the whole upload limit, and its bytes belong behind
  // an explicit tap, not an open viewer.
  const renderable = RENDERABLE_ORIGINALS.has(image.originalType ?? 'image/jpeg')
  const original = useEntryImageUrl(entryId, image.id, 'original', renderable)
  const [originalBroken, setOriginalBroken] = useState(false)
  const originalShown = renderable && !originalBroken && original.data !== undefined
  const shown = originalShown ? original.data : viewer.data

  const [downloading, setDownloading] = useState(false)
  const downloadOriginal = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      // The download bypasses the memo: one explicit save, and the blob is
      // revoked on a delay — WebKit resolves a blob download after the
      // click, so revoking in the same tick fails the save. The minute is
      // the save's lifetime, an explicit act apart from the viewed-photo
      // cache the sign-out clears.
      const response = await fetch(entryImageUrl(entryId, image.id, 'original'), {
        credentials: 'same-origin',
        headers: memberHeader(),
      })
      if (!response.ok) {
        throw new ApiError(extractErrorCode(await response.json().catch(() => null)))
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `${image.id}.${DOWNLOAD_EXTENSIONS[image.originalType ?? ''] ?? 'bin'}`
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (cause) {
      toast(journalErrorMessage(cause, t), 'danger')
    } finally {
      setDownloading(false)
    }
  }

  return (
    // A plain overlay, not ui/dialog: the lightbox is a photo on a scrim,
    // not a labelled panel (docs/design/README.md, overlays).
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim itself is the close affordance, and the button inside carries the role
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/72 p-4"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
    >
      <button
        type="button"
        className="absolute end-4 top-4 grid size-10 place-items-center rounded-full text-white/90 hover:bg-white/10"
        onClick={onClose}
        aria-label={t('ui.close')}
      >
        <Icon name="x" />
      </button>
      {shown === undefined ? (
        <Spinner className="size-8 text-white/80" />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: the photo sits on the scrim; the click keeps the viewer open, the scrim's own click closes it
        // biome-ignore lint/a11y/useKeyWithClickEvents: same — the keyboard path is Escape on the scrim, which closes the viewer
        <img
          src={shown}
          alt=""
          className="max-h-[82vh] max-w-full rounded-lg object-contain"
          onError={() => setOriginalBroken(true)}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      {renderable && !originalBroken && !original.isError && (
        <span className="font-mono text-meta tracking-wide text-white/70 uppercase">
          {original.data === undefined
            ? t('journal.viewerLoadingOriginal')
            : t('journal.viewerOriginalCaption')}
        </span>
      )}
      {!renderable && (
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg border border-white/30 px-4 py-2 text-sm text-white/90 hover:bg-white/10"
          disabled={downloading}
          onClick={(event) => {
            event.stopPropagation()
            void downloadOriginal()
          }}
        >
          {downloading && <Spinner className="size-4" />}
          {t('journal.downloadOriginal')}
        </button>
      )}
    </div>
  )
}

/*
 * The editor's photo section (docs/design/screens/diary-editor.html): the
 * chips of the photos already attached, the «Добавить» tile, and the
 * «N из 12» counter. The photos attach to an entry, so a pick on a not-yet-
 * saved entry asks the screen for one first — the editor creates the draft,
 * the way its publish-after-create already does (issue #15). Uploads go
 * through the API; the entry with its longer photo list comes back through
 * the sync, never through a hand-patched cache.
 */

/** How many photos one entry may carry — the API enforces the same bound. */
export const MAX_PHOTOS_PER_ENTRY = 12

interface PendingPhoto {
  /** The picker's own object URL, shown greyed while the upload runs. */
  key: string
  preview: string
}

export function EntryPhotoEditor({
  entryId,
  images,
  onNeedEntry,
}: {
  /** The entry the photos attach to; undefined until the editor has one. */
  entryId?: string
  images: StoredJournalEntryImage[]
  /** Called when photos are picked but no entry exists yet; answers the
   *  entry to attach to, or null when it could not be created. */
  onNeedEntry: () => Promise<string | null>
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingPhoto[]>([])
  const [removing, setRemoving] = useState<string[]>([])

  const onPick = async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    // The photos need an entry: an existing one, or one the screen creates
    // for the occasion — null means it could not, and the pick is dropped.
    const ensured: string | null = entryId ?? (await onNeedEntry())
    if (ensured === null) return
    const targetId: string = ensured
    const slotsLeft = MAX_PHOTOS_PER_ENTRY - images.length - pending.length
    const chosen = Array.from(files).slice(0, Math.max(slotsLeft, 0))
    if (chosen.length === 0) {
      toast(t('journal.errors.image_limit_reached'), 'danger')
      return
    }
    const placeholders = chosen.map((file) => ({
      key: `${file.name}:${file.size}:${Date.now()}`,
      preview: URL.createObjectURL(file),
    }))
    setPending((current) => [...current, ...placeholders])

    for (let index = 0; index < chosen.length; index += 1) {
      const file = chosen[index]
      const placeholder = placeholders[index]
      if (file === undefined || placeholder === undefined) continue
      try {
        await uploadEntryImage(targetId, file)
        setPending((current) => current.filter((candidate) => candidate.key !== placeholder.key))
        await triggerSync()
      } catch (cause) {
        setPending((current) => current.filter((candidate) => candidate.key !== placeholder.key))
        // The refusal is the answer about the row — the sync corrects it —
        // and the toast names what the API said, not "unexpected".
        void triggerSync()
        toast(journalErrorMessage(cause, t), 'danger')
      } finally {
        URL.revokeObjectURL(placeholder.preview)
      }
    }
  }

  const onRemove = async (imageId: string) => {
    if (entryId === undefined) return
    setRemoving((current) => [...current, imageId])
    try {
      await deleteEntryImage(entryId, imageId)
      await triggerSync()
    } catch (cause) {
      void triggerSync()
      toast(journalErrorMessage(cause, t), 'danger')
    } finally {
      setRemoving((current) => current.filter((candidate) => candidate !== imageId))
    }
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">{t('journal.photosTitle')}</h2>
        <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
          {t('journal.photoCounter', {
            count: images.length + pending.length,
            max: MAX_PHOTOS_PER_ENTRY,
          })}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 tablet:grid-cols-4">
        {images.map((image) => (
          <div key={image.id} className="relative">
            {removing.includes(image.id) ? (
              <div className="grid aspect-square place-items-center rounded-lg bg-muted">
                <Spinner className="size-5 text-muted-foreground" />
              </div>
            ) : entryId !== undefined ? (
              <EditorChip
                entryId={entryId}
                image={image}
                onRemove={() => void onRemove(image.id)}
              />
            ) : (
              // Photos only exist on a saved entry; a chip without an
              // entry to fetch from has nothing to show.
              <div className="aspect-square w-full rounded-lg bg-muted" />
            )}
          </div>
        ))}
        {pending.map((placeholder) => (
          <div key={placeholder.key} className="relative">
            <img
              src={placeholder.preview}
              alt=""
              className="aspect-square w-full rounded-lg object-cover opacity-60"
            />
            <div className="absolute inset-0 grid place-items-center">
              <Spinner className="size-5" />
            </div>
          </div>
        ))}
        {(images.length + pending.length < MAX_PHOTOS_PER_ENTRY || entryId === undefined) && (
          <button
            type="button"
            className="flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-muted"
            onClick={() => inputRef.current?.click()}
          >
            <Icon name="camera" className="size-5" />
            {t('journal.addPhoto')}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label={t('journal.addPhoto')}
              onChange={(event) => {
                void onPick(event.target.files)
                event.target.value = ''
              }}
            />
          </button>
        )}
      </div>
      <p className="mt-2.5 text-sm text-muted-foreground">{t('journal.photosHint')}</p>
    </div>
  )
}

function EditorChip({
  entryId,
  image,
  onRemove,
}: {
  entryId: string
  image: StoredJournalEntryImage
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const preview = useEntryImageUrl(entryId, image.id, 'feed', image.state === 'ready')
  if (image.state !== 'ready' || preview.data === undefined) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-lg bg-muted">
        {image.state === 'processing' ? (
          <Spinner className="size-5 text-muted-foreground" />
        ) : (
          <Icon name="image" className="size-5 text-muted-foreground" />
        )}
      </div>
    )
  }
  return (
    <div className="relative">
      <img src={preview.data} alt="" className="aspect-square w-full rounded-lg object-cover" />
      <button
        type="button"
        className="absolute end-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/55 text-white"
        onClick={onRemove}
        aria-label={t('journal.removePhoto')}
      >
        <Icon name="x" />
      </button>
    </div>
  )
}
