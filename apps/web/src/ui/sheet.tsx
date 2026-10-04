'use client'

import { Dialog as SheetPrimitive } from '@base-ui/react/dialog'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon.tsx'

/*
 * Ohana sheet (docs/design/README.md, "Overlays"): a bottom drawer with
 * a grabber below 920px, a centred 460px modal from 920px up; it rises
 * 40px without overshoot. Behaviour (focus trap, Esc) is Base UI's.
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

function SheetContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const { t } = useTranslation()
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          'glass fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86dvh] w-full max-w-[560px] flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-xl px-5 pt-2 pb-[calc(20px+env(safe-area-inset-bottom))] text-body text-card-foreground transition-transform duration-(--t-slow) ease-(--ease) outline-none data-starting-style:translate-y-10 data-ending-style:translate-y-10',
          'desktop:inset-0 desktop:m-auto desktop:h-fit desktop:max-h-[86dvh] desktop:max-w-[460px] desktop:rounded-xl desktop:px-5 desktop:pt-5 desktop:pb-5 desktop:data-starting-style:translate-y-10 desktop:data-ending-style:translate-y-10',
          className,
        )}
        {...props}
      >
        <div
          aria-hidden="true"
          data-slot="sheet-grabber"
          className="mx-auto mb-1 h-1 w-10 shrink-0 rounded-full bg-foreground/20 desktop:hidden"
        />
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={<Button variant="ghost" size="icon" className="absolute top-3 right-3" />}
          >
            <Icon name="x" className="size-[18px]" />
            <span className="sr-only">{t('ui.close')}</span>
          </SheetPrimitive.Close>
        )}
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
