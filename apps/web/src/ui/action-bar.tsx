import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana action bar (`.editor-bar` in the prototype, issue #61): the
 * glass bar fixed directly above the tab bar holding a screen's main
 * actions on phones — the journal editor, the event screen and the
 * event editor mount it. The bar glass recipe keeps only the inset
 * highlight (README "Glass"); the bar is hidden from 920px, where the
 * same actions live in the top bar. Its offset adds the bottom
 * safe-area inset the tab bar pads itself with, so it never covers
 * the tab bar; a screen that mounts it gets the bottom space reserved
 * by the member layout. Its minimum height is the `--action-bar-h`
 * token the layout's reserve and the toast viewport's lift read, so
 * the three cannot drift apart. Being `fixed`, it positions against
 * the viewport unless an ancestor is transformed (the design route's
 * shell demo uses that to pin the bar inside the demo box) — a screen
 * keeps its ancestors transform-free.
 */
export function ActionBar({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the bar groups a screen's buttons, it is not a form field set — a fieldset would drag in form semantics and the browser's own box; its accessible name is the caller's aria-label
    <div
      data-slot="action-bar"
      role="group"
      className={cn(
        'glass-bar fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] min-h-(--action-bar-h) z-30 flex items-center gap-2.5 rounded-none border-0 px-3.5 py-2.5 desktop:hidden',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}
