import type { createToastManager as createToastManagerType } from '@base-ui/react/toast'
import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { cn } from '@/lib/cn'

import { Icon } from '@/ui/icon.tsx'

/*
 * Ohana toast (docs/design/README.md, "Components"): a glass pill with
 * an ok or danger icon that hides after about 3 seconds. It sits above
 * the tab bar on mobile and bottom-right on desktop. Base UI owns
 * queueing, swiping and reduced-motion behaviour; like the prototype's
 * `.toast` it is an icon and text only — no close control.
 */

export type ToastTone = 'ok' | 'danger'

interface OhanaToastData {
  tone?: ToastTone
}

// The 1.8 packaging misdeclares createToastManager as type-only in the
// public index; the value lives on the Toast namespace.
const createToastManager = ToastPrimitive.createToastManager as typeof createToastManagerType

export const toastManager = createToastManager<OhanaToastData>()

/** Fire-and-forget toast, usable from anywhere in the client. */
export function toast(title: string, tone: ToastTone = 'ok') {
  toastManager.add({ title, data: { tone } })
}

export function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} timeout={3200}>
      <ToastList />
    </ToastPrimitive.Provider>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager<OhanaToastData>()

  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h)+16px)] z-80 flex flex-col items-center gap-2 outline-none desktop:bottom-6 desktop:items-end desktop:pr-6"
    >
      {toasts.map((item) => {
        const tone = item.data?.tone ?? 'ok'
        return (
          <ToastPrimitive.Root
            key={item.id}
            toast={item}
            data-slot="toast"
            swipeDirection={tone === 'danger' ? ['down', 'right'] : 'down'}
            className={cn(
              'glass pointer-events-auto relative flex max-w-[min(92vw,480px)] items-center gap-2.5 rounded-full px-[18px] py-3 text-[14.5px] font-medium text-foreground transition-[opacity,transform] duration-(--t-base) ease-(--ease) animate-toast-in data-ending-style:translate-y-2 data-ending-style:opacity-0 data-swiping:translate-y-(--toast-swipe-movement-y)',
            )}
          >
            <Icon
              name={tone === 'danger' ? 'alert' : 'check'}
              className={cn(
                'size-[18px] shrink-0',
                tone === 'danger' ? 'text-destructive' : 'text-ok',
              )}
            />
            <ToastPrimitive.Title className="min-w-0 text-left" />
          </ToastPrimitive.Root>
        )
      })}
    </ToastPrimitive.Viewport>
  )
}
