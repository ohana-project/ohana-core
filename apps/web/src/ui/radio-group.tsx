'use client'

import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { cn } from '@/lib/cn'

/*
 * Ohana radio group: the prototype's `role="radiogroup"` rows of native
 * accent-coloured radios (onboarding.html's language cards). Base UI's
 * group gives the accessible group with roving focus, and each radio
 * draws its own 18px circle — accent fill with an accent-fg dot when
 * checked, like `accent-color: var(--accent)` on the prototype's native
 * inputs. A hidden native input rides along, so a surrounding label
 * forwards its clicks.
 */

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('flex w-full gap-2.5', className)}
      {...props}
    />
  )
}

function Radio({ className, ...props }: RadioPrimitive.Root.Props) {
  return (
    <RadioPrimitive.Root
      data-slot="radio"
      className={cn(
        'flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-card transition-colors duration-(--t-fast) ease-(--ease) data-checked:border-primary data-checked:bg-primary',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-indicator"
        className="size-[7px] rounded-full bg-primary-foreground"
      />
    </RadioPrimitive.Root>
  )
}

export { Radio, RadioGroup }
