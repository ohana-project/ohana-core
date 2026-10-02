import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { WishlistMineScreen } from '@/features/wishlist/wishlist-mine-screen.tsx'

/*
 * The member's own wishlist (issue #18): every wish they have made, with
 * the editor sheet for adding, editing, and removing.
 */
function WishlistMinePage() {
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <WishlistMineScreen />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/wishlist/mine')({
  component: WishlistMinePage,
})
