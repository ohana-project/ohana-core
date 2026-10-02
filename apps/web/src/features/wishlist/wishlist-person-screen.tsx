import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveMemberId } from '@/data/session-registry.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
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
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import {
  useCancelReservation,
  useFavoriteWish,
  useReserveWish,
  useUnfavoriteWish,
  useWishlistData,
  wishlistErrorMessage,
} from './use-wishlist.ts'
import { WishRow } from './wish-row.tsx'
import { authorName, openWishesOf, reservationFor, wishlistUpdatedAt } from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * One member's wishlist (docs/design/screens/wishlist-person.html): the
 * open wishes they are hoping for, creation order — a received wish has
 * left the open wishes (issue #18). Every row carries the gift controls
 * (issue #19): the heart is the member's private favorite, the reserve
 * button claims the wish for giving, and a held wish names who holds it.
 * The wishes, the favorites, and the reservations read from the
 * synchronised partition, so the screen answers offline like the rest of
 * the section (ADR-0002) — and the reservation's author sees none of it,
 * the server never having sent it to them.
 */
export function WishlistPersonScreen({ memberId }: { memberId: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { snapshot, wishes, favorites, reservations, profiles, downloaded } = useWishlistData()
  const meId = getActiveMemberId()

  const isMe = memberId === meId
  useEffect(() => {
    if (isMe) void navigate({ to: '/wishlist/mine', replace: true })
  }, [isMe, navigate])

  const favoriteWish = useFavoriteWish()
  const unfavoriteWish = useUnfavoriteWish()
  const reserveWish = useReserveWish()
  const cancelReservation = useCancelReservation()
  const pending =
    favoriteWish.isPending ||
    unfavoriteWish.isPending ||
    reserveWish.isPending ||
    cancelReservation.isPending

  // The wish whose reserve confirm is open, and the one whose cancel
  // confirm is open: both claims are made consciously (the prototype's
  // OHANA_CONFIRM), and the id, not the row, keeps the dialog honest while
  // a sync re-delivers the wish.
  const [confirmReserveId, setConfirmReserveId] = useState<string | undefined>(undefined)
  const [confirmCancelId, setConfirmCancelId] = useState<string | undefined>(undefined)
  const confirmReserveWish = wishes.find((wish) => wish.id === confirmReserveId)
  const confirmCancelWish = wishes.find((wish) => wish.id === confirmCancelId)

  const profile = profiles.find((candidate) => candidate.id === memberId)
  const name = authorName(memberId, profiles, t('wishlist.authorUnknown'))
  const open = openWishesOf(wishes, memberId)
  const updated = wishlistUpdatedAt(open)

  const toggleFavorite = (wishId: string, on: boolean) => {
    const mutate = on ? unfavoriteWish : favoriteWish
    mutate.mutate(
      { wishId },
      {
        onSuccess: () => {
          toast(on ? t('wishlist.unfavoritedToast') : t('wishlist.favoritedToast'))
        },
        onError: (error) => toast(wishlistErrorMessage(error, t), 'danger'),
      },
    )
  }

  const reserve = (wishId: string) => {
    reserveWish.mutate(
      { wishId },
      {
        onSuccess: () => {
          setConfirmReserveId(undefined)
          toast(t('wishlist.reservedToast', { name }))
        },
        onError: (error) => {
          setConfirmReserveId(undefined)
          toast(wishlistErrorMessage(error, t), 'danger')
        },
      },
    )
  }

  const cancel = (wishId: string) => {
    cancelReservation.mutate(
      { wishId },
      {
        onSuccess: () => {
          setConfirmCancelId(undefined)
          toast(t('wishlist.cancelledToast'))
        },
        onError: (error) => {
          setConfirmCancelId(undefined)
          toast(wishlistErrorMessage(error, t), 'danger')
        },
      },
    )
  }

  return (
    <WishlistShell title={t('wishlist.personTitle', { name })} backTo="/wishlist" width="narrow">
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : !downloaded ? (
        // Before anything else: a device with nothing downloaded — or a
        // fraction left by an owed replay — says so, instead of reading the
        // absent profile as a missing member or counting the rows it
        // happens to hold (ADR-0014, architecture.md web rules).
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        </Card>
      ) : profile === undefined ? (
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="users" />
            </EmptyMedia>
            <EmptyTitle>{t('wishlist.memberMissingTitle')}</EmptyTitle>
            <EmptyDescription>{t('wishlist.memberMissingText')}</EmptyDescription>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 pt-6">
          <div className="flex items-center gap-3">
            <Avatar size="lg" hue={hueFromId(memberId)}>
              <AvatarFallback>{monogramOf(name)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="text-h3">{name}</span>
              <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
                {updated === undefined
                  ? t('wishlist.openCount', { count: open.length })
                  : `${t('wishlist.openCount', { count: open.length })} · ${t('wishlist.updated', {
                      moment: personMoment(updated, i18n.language),
                    })}`}
              </span>
            </div>
          </div>

          {/* The surprise rule (the prototype's venue-note): the author of
              these wishes sees neither reservations nor anyone's favorites. */}
          <div className="flex items-start gap-2.5 rounded-md border border-border px-4 py-3">
            <Icon name="eye-off" className="mt-0.5 size-4 shrink-0 text-accent" />
            <p className="text-sm break-words text-muted-foreground">
              {t('wishlist.personSurpriseNote', { name })}
            </p>
          </div>

          {open.length === 0 ? (
            <Card>
              <Empty>
                <EmptyMedia>
                  <Icon name="gift" />
                </EmptyMedia>
                <EmptyTitle>{t('wishlist.personEmptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('wishlist.personEmptyText', { name })}</EmptyDescription>
              </Empty>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {open.map((wish) => {
                const mineFavorite = favorites.find((row) => row.wishId === wish.id)
                const held = reservationFor(reservations, wish.id)
                return (
                  <WishRow
                    key={wish.id}
                    wish={wish}
                    favorite={
                      mineFavorite === undefined
                        ? { on: false, pending, onToggle: () => toggleFavorite(wish.id, false) }
                        : { on: true, pending, onToggle: () => toggleFavorite(wish.id, true) }
                    }
                    reservation={{
                      mine: held !== undefined && held.memberId === meId,
                      reserverName:
                        held === undefined
                          ? undefined
                          : authorName(held.memberId, profiles, t('wishlist.authorUnknown')),
                      reserverHue: held === undefined ? undefined : hueFromId(held.memberId),
                      pending,
                      onReserve: () => setConfirmReserveId(wish.id),
                      onCancel: () => setConfirmCancelId(wish.id),
                    }}
                  />
                )
              })}
            </div>
          )}

          <p className="text-meta text-muted-foreground">{t('wishlist.personHint')}</p>
        </div>
      )}

      {confirmReserveWish !== undefined && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !reserveWish.isPending) setConfirmReserveId(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('wishlist.reserveConfirmTitle', { name: confirmReserveWish.title })}
              </DialogTitle>
              <DialogDescription>{t('wishlist.reserveConfirmText', { name })}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={reserveWish.isPending}
                onClick={() => setConfirmReserveId(undefined)}
              >
                {t('ui.close')}
              </Button>
              <Button
                disabled={reserveWish.isPending}
                onClick={() => reserve(confirmReserveWish.id)}
              >
                {t('wishlist.reserveConfirmLabel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {confirmCancelWish !== undefined && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next && !cancelReservation.isPending) setConfirmCancelId(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('wishlist.cancelConfirmTitle')}</DialogTitle>
              <DialogDescription>{t('wishlist.cancelConfirmText')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                disabled={cancelReservation.isPending}
                onClick={() => setConfirmCancelId(undefined)}
              >
                {t('ui.close')}
              </Button>
              <Button
                variant="destructive"
                disabled={cancelReservation.isPending}
                onClick={() => cancel(confirmCancelWish.id)}
              >
                {t('wishlist.cancelConfirmLabel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </WishlistShell>
  )
}

/** The person screen's meta line, "вчера в 21:04" style kept simple: the
 *  localized moment the list was last touched. */
function personMoment(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(iso))
    .toLocaleLowerCase(locale)
}
