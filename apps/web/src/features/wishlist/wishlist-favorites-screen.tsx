import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { StoredGiftFavorite, StoredWish } from '@/data/local-store.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { useUnfavoriteWish, useWishlistData, wishlistErrorMessage } from './use-wishlist.ts'
import { authorName, favoritesWithWishes } from './wishlist-entries.ts'
import { WishlistShell } from './wishlist-shell.tsx'

/*
 * The member's gift favorites (docs/design/screens/wishlist-favorites.html,
 * issue #19): the ideas they have quietly set aside from the other members'
 * wishlists. The rows read from the synchronised partition — the favorites
 * travel to this member alone, so the screen answers offline like the rest
 * of the section (ADR-0002) — and each leads to the wishlist it came from.
 *
 * The screen follows its prototype (issue #67): a serif heading over the
 * muted count line, each card one link with the ghost removal and the
 * trailing chevron, the bare empty state with its way to the wishlists,
 * and the mono footer line.
 */
export function WishlistFavoritesScreen() {
  const { t } = useTranslation()
  const { snapshot, wishes, favorites, profiles, downloaded } = useWishlistData()
  const unfavoriteWish = useUnfavoriteWish()

  const joined = favoritesWithWishes(favorites, wishes)

  const remove = (favorite: StoredGiftFavorite) => {
    unfavoriteWish.mutate(
      { wishId: favorite.wishId },
      {
        onSuccess: () => toast(t('wishlist.unfavoritedToast')),
        onError: (error) => toast(wishlistErrorMessage(error, t), 'danger'),
      },
    )
  }

  return (
    <WishlistShell title={t('wishlist.favoritesTitle')} backTo="/wishlist" width="narrow">
      {snapshot.isPending ? (
        <div className="grid place-items-center py-10">
          <Spinner className="size-6" />
        </div>
      ) : !downloaded ? (
        // A device with nothing downloaded says so instead of counting the
        // rows it happens to hold (ADR-0014, architecture.md web rules).
        <Card className="mt-5">
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col pt-5">
          <header className="mb-4.5">
            <h1 className="text-display-lg">{t('wishlist.favoritesTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('wishlist.favoritesCount', { count: joined.length })} ·{' '}
              {t('wishlist.favoritesPrivate')}
            </p>
          </header>

          {joined.length === 0 ? (
            // The prototype's bare empty state (`.empty`, no card around
            // it), its button in the content slot.
            <Empty className="py-14">
              <EmptyMedia>
                <Icon name="heart" />
              </EmptyMedia>
              <EmptyTitle>{t('wishlist.favoritesEmptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('wishlist.favoritesEmptyText')}</EmptyDescription>
              <EmptyContent>
                <Button render={<Link to="/wishlist" />}>
                  {t('wishlist.favoritesEmptyAction')}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {joined.map(({ favorite, wish }) => {
                const author = authorName(wish.authorId, profiles, t('wishlist.authorUnknown'))
                return (
                  <FavoriteRow
                    key={favorite.id}
                    wish={wish}
                    author={author}
                    removePending={unfavoriteWish.isPending}
                    onRemove={() => remove(favorite)}
                  />
                )
              })}
            </div>
          )}

          <p className="mx-1 mt-4.5 font-mono text-meta uppercase text-muted-foreground">
            {t('wishlist.favoritesHint')}
          </p>
        </div>
      )}
    </WishlistShell>
  )
}

/**
 * One bookmark (the prototype's `card-link` row): the accent heart leads,
 * the title and its wishlist travel in the body, and the trailing ghost
 * removal and 18px chevron close the row. One link per card — the
 * stretched link covers the card the way the prototype's anchor wraps the
 * whole row, with the removal a positioned sibling above it: valid HTML
 * where the prototype nests a button inside the link.
 */
function FavoriteRow({
  wish,
  author,
  removePending,
  onRemove,
}: {
  wish: StoredWish
  author: string
  removePending: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  return (
    <Card variant="list" hoverable className="relative">
      <div className="flex items-center gap-3.5 px-3.5 py-3.5">
        {/* The prototype's accent heart (`.leading`, the outline glyph
            tinted with the accent — the sprite's own fill="none" keeps even
            the inline `fill:currentColor` of the prototype an outline
            heart). */}
        <Icon name="heart" className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <Link
            to="/wishlist/$memberId"
            params={{ memberId: wish.authorId }}
            className="after:absolute after:inset-0 flex min-w-0 flex-col"
          >
            {/* break-words: a title of the contract's 200 characters must
                wrap instead of overflowing. */}
            <span className="text-body font-medium break-words">{wish.title}</span>
            {/* The prototype's sub line: the wishlist the idea came from,
                then the wish's own hint after the separator (the price is
                another ticket's). */}
            <span className="mt-px text-sm break-words text-muted-foreground">
              {t('wishlist.favoritesFrom', { name: author })}
              {wish.details !== undefined && <> · {wish.details}</>}
            </span>
          </Link>
        </div>
        <div className="relative flex flex-none items-center gap-2 text-muted-foreground">
          <Button variant="ghost" size="sm" disabled={removePending} onClick={onRemove}>
            {t('wishlist.favoritesRemove')}
          </Button>
          {/* The prototype's trailing chevron (`.trailing svg`, 18px). */}
          <Icon name="chevron-right" className="size-4.5" />
        </div>
      </div>
    </Card>
  )
}
