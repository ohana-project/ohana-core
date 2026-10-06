import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { StoredWish } from '@/data/local-store.ts'
import { cn } from '@/lib/cn'
import { monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Icon } from '@/ui/icon.tsx'
import { chipDomain } from './wishlist-entries.ts'

/**
 * One wish row (the prototypes' wish card, issue #67): the body and the
 * actions on one centred line — the author's rows at their 14px padding
 * and 12px gap (wishlist-mine.html), another member's at 16px top and
 * bottom with the body pulled 8px off the actions (wishlist-person.html).
 * The details and the link's domain chip travel under the title, and the
 * author's rows carry the edit button — only the author can change a
 * wish, so only their screens offer the way to.
 *
 * Another member's rows carry the gift controls (issue #19): the heart is
 * the 40px bordered round button that fills with the soft accent when
 * pressed, a held wish shows the reserved pill — accent when the
 * reservation is the member's own —, and a free wish is one press away
 * from the claim. The author's own rows show none of the gift controls:
 * they can never favorite their own wish, and no reservation on it may
 * reach them (issue #19).
 */
export function WishRow({
  wish,
  editable = false,
  onEdit,
  favorite,
  reservation,
}: {
  wish: StoredWish
  editable?: boolean
  onEdit?: () => void
  favorite?: {
    on: boolean
    pending?: boolean
    onToggle: () => void
  }
  reservation?: {
    /** The reservation is the member's own — the cancel belongs beside it. */
    mine: boolean
    /** The reserving member's name and hue while the wish is held — theirs
     *  or another member's; undefined when the wish is free. */
    reserverName?: string
    reserverHue?: number
    pending?: boolean
    onReserve: () => void
    onCancel: () => void
  }
}) {
  const { t } = useTranslation()
  const received = wish.receivedAt !== undefined
  return (
    <Card variant="list">
      <div className={cn('flex items-center px-3.5', editable ? 'gap-3 py-3.5' : 'gap-3.5 py-4')}>
        <div className={cn('min-w-0 flex-1', !editable && 'pr-2')}>
          {received && (
            <span className="mb-1.5 flex w-fit">
              <Badge variant="ok">{t('wishlist.receivedPill')}</Badge>
            </span>
          )}
          {/* break-words: a title of the contract's 200 characters, or a
              detail with no space in it, must wrap instead of overflowing. */}
          <span
            className={cn(
              'block text-body font-medium break-words',
              // The prototype's `.title.is-received`: muted, struck
              // through at half the ink.
              received && 'text-muted-foreground line-through decoration-muted-foreground/50',
            )}
          >
            {wish.title}
          </span>
          {wish.details !== undefined && (
            <span className="mt-px block text-sm break-words text-muted-foreground">
              {wish.details}
            </span>
          )}
          {wish.link !== undefined && (
            // The prototype's `.wish-link`: an accent chip at the `sm`
            // size, 6px under the text above it, showing only the domain —
            // the full target rides `title`.
            <a
              href={wish.link}
              target="_blank"
              rel="noopener noreferrer"
              title={wish.link}
              className="mt-1.5 inline-flex min-h-5.5 max-w-full items-center gap-1.5 text-sm font-medium text-primary [overflow-wrap:anywhere] hover:underline hover:underline-offset-3"
            >
              <Icon name="globe" className="size-3.5 shrink-0" />
              {/* break-all: a hostname has no space in it, so the whole
                  of it wraps instead of ever being cut — nothing of
                  where the link resolves is hidden, on any width. */}
              <span className="break-all">{chipDomain(wish.link)}</span>
            </a>
          )}
        </div>
        {editable ? (
          <Button variant="ghost" size="icon" aria-label={t('wishlist.edit')} onClick={onEdit}>
            <Icon name="edit" />
          </Button>
        ) : (
          // The prototype's `.wish-actions`: one centred row, 8px between
          // the controls, wrapping rather than squeezing the body.
          <div className="flex max-w-full flex-none flex-wrap items-center justify-end gap-2">
            {favorite !== undefined && (
              <FavButton on={favorite.on} pending={favorite.pending} onToggle={favorite.onToggle} />
            )}
            {reservation !== undefined &&
              (reservation.mine ? (
                <>
                  <BookedPill
                    mine
                    name={reservation.reserverName ?? ''}
                    hue={reservation.reserverHue}
                  >
                    {t('wishlist.reservedByMe')}
                  </BookedPill>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={reservation.pending}
                    onClick={reservation.onCancel}
                  >
                    {t('wishlist.cancelReservation')}
                  </Button>
                </>
              ) : reservation.reserverName !== undefined ? (
                // Held by another member: the pill names them, with who
                // holds the wish being the point of the reservation
                // (issue #19).
                <BookedPill
                  mine={false}
                  name={reservation.reserverName}
                  hue={reservation.reserverHue}
                >
                  {t('wishlist.reservedBy', { name: reservation.reserverName })}
                </BookedPill>
              ) : (
                // Free: the claim is one press away — unless the wish has
                // been received, and nothing is being given anymore.
                !received && (
                  <Button size="sm" disabled={reservation.pending} onClick={reservation.onReserve}>
                    {t('wishlist.reserve')}
                  </Button>
                )
              ))}
          </div>
        )}
      </div>
    </Card>
  )
}

/**
 * The prototype's `.fav-btn` (issue #67): a 40px bordered round button,
 * muted at rest, that fills with the soft accent when pressed — the
 * pressed state riding `aria-pressed`, like the prototype's own markup.
 */
function FavButton({
  on,
  pending,
  onToggle,
}: {
  on: boolean
  pending?: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-pressed={on}
      // The label carries the state ("в избранное" / "убрать из
      // избранного") beside the pressed attribute the prototype pins.
      aria-label={on ? t('wishlist.unfavorite') : t('wishlist.favorite')}
      disabled={pending}
      onClick={onToggle}
      className={cn(
        'grid size-10 flex-none place-items-center rounded-full border transition-colors duration-(--t-fast) ease-(--ease)',
        'disabled:pointer-events-none disabled:opacity-50',
        // Branch-exclusive colours: the merger does not know the theme
        // colour names as one group, so a base `bg-card` beside a pressed
        // `bg-primary-soft` would keep both and let the stylesheet's order
        // pick — the states therefore never share a background class.
        on
          ? 'border-[color-mix(in_oklch,var(--accent)_38%,transparent)] bg-primary-soft text-primary'
          : 'border-border bg-card text-muted-foreground hover:border-[color-mix(in_oklch,var(--fg)_28%,var(--border))] hover:text-foreground',
      )}
    >
      {/* The pressed heart stays the outline glyph tinted with the accent:
          the prototype's own sprite stamps fill="none" on its symbols, so
          even its `.fav-btn[aria-pressed='true'] svg { fill: currentColor }`
          renders as the outline heart (issue #67). */}
      <Icon name="heart" className="size-4.5" />
    </button>
  )
}

/**
 * The prototype's `.wish-booked` (issue #67): a pill around the
 * reserving member's monogram — on the fg-soft fill naming another
 * member, on the soft accent naming the member's own claim
 * (`.wish-booked.is-mine`).
 */
function BookedPill({
  mine,
  name,
  hue,
  children,
}: {
  mine: boolean
  name: string
  hue?: number
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex flex-none items-center gap-1.75 rounded-full py-1 pr-3 pl-1 text-meta font-medium',
        mine ? 'bg-primary-soft text-primary' : 'bg-(--fg-soft) text-muted-foreground',
      )}
    >
      <Avatar size="xs" hue={hue}>
        <AvatarFallback>{monogramOf(name)}</AvatarFallback>
      </Avatar>
      {children}
    </span>
  )
}
