import { createFileRoute } from '@tanstack/react-router'
import { MemberSessionGate } from '@/features/member/member-session-gate.tsx'
import { WishlistPersonScreen } from '@/features/wishlist/wishlist-person-screen.tsx'

/*
 * One member's wishlist (issue #18): the open wishes they are hoping for.
 */
function WishlistPersonPage() {
  const { memberId } = Route.useParams()
  return (
    <MemberSessionGate require="signed-in" redirectTo="/signin">
      <WishlistPersonScreen memberId={memberId} />
    </MemberSessionGate>
  )
}

export const Route = createFileRoute('/wishlist/$memberId')({
  component: WishlistPersonPage,
})
