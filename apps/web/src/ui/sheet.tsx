'use client'

import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana sheet (docs/design/README.md, "Overlays"): a bottom drawer with
 * a grabber below 920px, a centred 460px modal from 920px up; it rises
 * 40px without overshoot. No close X, like the prototypes — Esc and
 * the scrim close it, and Base UI traps focus; a screen that needs an
 * explicit dismiss renders SheetClose itself. The mobile drawer keeps
 * only its top hairline; the desktop modal the full one. The grabber
 * carries the prototype's `margin: 6px auto 14px` — the body wrapper
 * below it holds the content gap, so the margins are exact.
 */

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        'scrim fixed inset-0 z-50 transition-opacity duration-(--t-base) ease-(--ease) data-starting-style:opacity-0 data-ending-style:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

function SheetContent({ className, children, ...props }: SheetPrimitive.Popup.Props) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          // the mobile drawer keeps only its top hairline; the `!` beats
          // the glass recipe's full border, which sorts after plain
          // utilities — the desktop variant re-asserts the full hairline
          'glass fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86dvh] w-full max-w-[560px] flex-col overflow-y-auto overscroll-contain rounded-t-xl border-x-0! border-b-0! px-5 pt-2 pb-[calc(20px+env(safe-area-inset-bottom))] text-body text-card-foreground transition-transform duration-(--t-slow) ease-(--ease) outline-none data-starting-style:translate-y-10 data-ending-style:translate-y-10',
          'desktop:inset-0 desktop:m-auto desktop:h-fit desktop:max-h-[86dvh] desktop:max-w-[460px] desktop:rounded-xl desktop:border-x! desktop:border-b! desktop:px-5 desktop:pt-5 desktop:pb-5 desktop:data-starting-style:translate-y-10 desktop:data-ending-style:translate-y-10',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          data-slot="sheet-grabber"
          className="mx-auto mb-3.5 mt-1.5 h-1 w-10 shrink-0 rounded-full bg-foreground/20 desktop:hidden"
        />
        <div data-slot="sheet-body" className="flex min-h-0 flex-col gap-4">
          {children}
        </div>
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="sheet-header" className={cn('flex flex-col gap-1', className)} {...props} />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2.5', className)}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('font-display text-h2 font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
}
