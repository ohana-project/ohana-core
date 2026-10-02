import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'

/*
 * Where each shell section leads (docs/design/README.md, "Layout"): home,
 * and the section screens as their tickets land them — the journal with
 * #15, the wishlist with #18, the calendar with #20. One handler for every
 * member-area shell, so a section leads to the same screen from the home,
 * the settings area, and the journal alike.
 */
export function useSectionNav() {
  const navigate = useNavigate()
  return useCallback(
    (id: string) => {
      if (id === 'home') void navigate({ to: '/' })
      if (id === 'journal') void navigate({ to: '/journal' })
      if (id === 'calendar') void navigate({ to: '/calendar' })
      if (id === 'wishlist') void navigate({ to: '/wishlist' })
    },
    [navigate],
  )
}
