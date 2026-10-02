import { useTranslation } from 'react-i18next'
import type { StoredWish } from '@/data/local-store.ts'
import { monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Icon } from '@/ui/icon.tsx'
import { chipDomain } from './wishlist-entries.ts'

/**
 * One wish row (the prototypes' wish card, issue #18): the received mark
 * strikes the title out, the details and the link's domain chip travel
 * under the title, and the author's rows carry the edit button — only the
 * author can change a wish, so only their screens offer the way to.
 *
 * Another member's rows carry the gift controls (issue #19): the heart
 * toggles the member's private favorite, and the reservation area shows
 * the claim's state — free with a reserve button, held by another member
 * with their name, held by the member themselves with the cancel beside
 * it. The author's own rows show neither: they can never favorite their
 * own wish, and no reservation on it may reach them (issue #19).
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
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {received && (
            <span className="w-fit">
              <Badge variant="ok">{t('wishlist.receivedPill')}</Badge>
            </span>
          )}
          {/* break-words: a title of the contract's 200 characters, or a
              detail with no space in it, must wrap instead of overflowing. */}
          <span
            className={`break-words text-h3 ${received ? 'text-muted-foreground line-through' : ''}`}
          >
            {wish.title}
          </span>
          {wish.details !== undefined && (
            <span className="text-sm break-words text-muted-foreground">{wish.details}</span>
          )}
          {wish.link !== undefined && (
            <a
              href={wish.link}
              target="_blank"
              rel="noopener noreferrer"
              // The full target on hover: the chip shows only the
              // hostname, or the raw link when there is none.
              title={wish.link}
              className="inline-flex w-fit max-w-full items-start gap-1.5 text-sm text-accent hover:underline"
            >
              <Icon name="globe" className="mt-0.5 size-4 shrink-0" />
              {/* break-all: a hostname has no space in it, so the whole
                  of it wraps instead of ever being cut — nothing of
                  where the link resolves is hidden, on any width. */}
              <span className="break-all">{chipDomain(wish.link)}</span>
            </a>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {favorite !== undefined && (
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={favorite.on}
              aria-label={favorite.on ? t('wishlist.unfavorite') : t('wishlist.favorite')}
              disabled={favorite.pending}
              onClick={favorite.onToggle}
            >
              {/* fill-current: the pressed heart is the filled one the
                  prototype draws; the stroke holds at 1.5 either way. */}
              <Icon
                name="heart"
                className={`size-5 ${favorite.on ? 'fill-current text-accent' : ''}`}
              />
            </Button>
          )}
          {reservation !== undefined &&
            (reservation.mine ? (
              <>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Avatar size="xs" hue={reservation.reserverHue}>
                    <AvatarFallback>{monogramOf(reservation.reserverName ?? '')}</AvatarFallback>
                  </Avatar>
                  {t('wishlist.reservedByMe')}
                </span>
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
              // Held by another member: the pill names them, with who holds
              // the wish being the point of the reservation (issue #19).
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Avatar size="xs" hue={reservation.reserverHue}>
                  <AvatarFallback>{monogramOf(reservation.reserverName)}</AvatarFallback>
                </Avatar>
                {t('wishlist.reservedBy', { name: reservation.reserverName })}
              </span>
            ) : (
              // Free: the claim is one press away — unless the wish has
              // been received, and nothing is being given anymore.
              !received && (
                <Button size="sm" disabled={reservation.pending} onClick={reservation.onReserve}>
                  {t('wishlist.reserve')}
                </Button>
              )
            ))}
          {editable && (
            <Button variant="ghost" size="icon" aria-label={t('wishlist.edit')} onClick={onEdit}>
              <Icon name="edit" />
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
