import { cn } from 'cn'
import type * as React from 'react'

import { AvatarGroup } from '@/ui/avatar.tsx'

/*
 * Ohana avatar stack (`.avatar-stack` in the prototype): overlapping
 * monograms with a background-coloured rim, 8px overlap. Built on the
 * Avatar group primitive; pass <Avatar /> children.
 */
export function AvatarStack({ className, ...props }: React.ComponentProps<typeof AvatarGroup>) {
  return (
    <AvatarGroup
      data-slot="avatar-stack"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...props}
    />
  )
}
