import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { WishlistsScreen } from '@/features/wishlist/wishlists-screen.tsx'

/*
 * The wishlists overview (issue #18): the member's own list beside the
 * other members' lists with their open-wish counts.
 */
function WishlistsPage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <WishlistsScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/wishlist/')({
  component: WishlistsPage,
})
