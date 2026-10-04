'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import type * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

import { Button } from '@/ui/button'
import { Icon } from '@/ui/icon.tsx'

/*
 * Ohana dialog (docs/design/README.md, "Components"): 440px on the
 * glass recipe, rising 14px from 98% scale. Behaviour (focus trap,
 * Esc) is Base UI's; only the appearance is ours.
 */

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        'scrim fixed inset-0 isolate z-50 transition-opacity duration-(--t-base) ease-(--ease) data-starting-style:opacity-0 data-ending-style:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const { t } = useTranslation()
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'glass fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-3rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl p-[22px] text-body text-card-foreground transition-transform duration-(--t-slow) ease-(--ease) outline-none data-starting-style:translate-y-[calc(-50%+14px)] data-starting-style:scale-[0.98] data-ending-style:translate-y-[calc(-50%+14px)] data-ending-style:scale-[0.98]',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Button variant="ghost" size="icon" className="absolute top-3 right-3" />}
          >
            <Icon name="x" className="size-[18px]" />
            <span className="sr-only">{t('ui.close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-header" className={cn('flex flex-col gap-1', className)} {...props} />
  )
}

function DialogFooter({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-display text-h2 font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a:hover]:text-primary',
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
