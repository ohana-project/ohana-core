import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { WishlistFavoritesScreen } from '@/features/wishlist/wishlist-favorites-screen.tsx'

/*
 * The member's gift favorites (issue #19): the ideas set aside from the
 * other members' wishlists, private to this member.
 */
function WishlistFavoritesPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <WishlistFavoritesScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/wishlist/favorites')({
  component: WishlistFavoritesPage,
})
