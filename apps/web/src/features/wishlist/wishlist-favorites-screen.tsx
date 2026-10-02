import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { StoredGiftFavorite } from '@/data/local-store.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
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
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="cloud-off" />
            </EmptyMedia>
            <EmptyTitle>{t('sync.nothingOffline')}</EmptyTitle>
            <EmptyDescription>{t('sync.nothingOfflineHint')}</EmptyDescription>
          </Empty>
        </Card>
      ) : joined.length === 0 ? (
        <Card className="mt-6">
          <Empty>
            <EmptyMedia>
              <Icon name="heart" />
            </EmptyMedia>
            <EmptyTitle>{t('wishlist.favoritesEmptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('wishlist.favoritesEmptyText')}</EmptyDescription>
            <EmptyMedia className="mt-3">
              <Button render={<Link to="/wishlist" />}>{t('wishlist.favoritesEmptyAction')}</Button>
            </EmptyMedia>
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-6 pt-6">
          <span className="font-mono text-meta tracking-wide text-muted-foreground uppercase">
            {t('wishlist.favoritesCount', { count: joined.length })} ·{' '}
            {t('wishlist.favoritesPrivate')}
          </span>
          <div className="flex flex-col gap-3">
            {joined.map(({ favorite, wish }) => {
              const author = authorName(wish.authorId, profiles, t('wishlist.authorUnknown'))
              return (
                <Card key={favorite.id} className="gap-0 py-0" hoverable>
                  <div className="flex items-start gap-3 px-5 py-4">
                    <Icon name="heart" className="mt-1 size-5 shrink-0 fill-current text-accent" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link
                        to="/wishlist/$memberId"
                        params={{ memberId: wish.authorId }}
                        className="flex min-w-0 flex-col gap-0.5"
                      >
                        <span className="text-h3 break-words">{wish.title}</span>
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          {t('wishlist.favoritesFrom', { name: author })}
                        </span>
                      </Link>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={unfavoriteWish.isPending}
                        onClick={() => remove(favorite)}
                      >
                        {t('wishlist.favoritesRemove')}
                      </Button>
                      <Link
                        to="/wishlist/$memberId"
                        params={{ memberId: wish.authorId }}
                        aria-label={t('wishlist.favoritesOpen', { name: author })}
                        className="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Icon name="chevron-right" className="size-5" />
                      </Link>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
          <p className="text-meta text-muted-foreground">{t('wishlist.favoritesHint')}</p>
        </div>
      )}
    </WishlistShell>
  )
}
