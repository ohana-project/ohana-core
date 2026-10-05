'use client'

import { Radio as RadioPrimitive } from '@base-ui/react/radio'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import type * as React from 'react'
import { cn } from '@/lib/cn'
import { cardHoverableClass } from '@/ui/card.tsx'

/*
 * Ohana radio group: the prototype's `role="radiogroup"` rows of native
 * accent-coloured radios (onboarding.html's language cards). Base UI's
 * group gives the accessible group with roving focus, and each radio
 * draws its own 18px circle — accent fill with an accent-fg dot when
 * checked, like `accent-color: var(--accent)` on the prototype's native
 * inputs. A hidden native input rides along, so a surrounding label
 * forwards its clicks. `RadioCard` is the prototype's
 * `label.card.card-link`: the card recipe with the link-card lift
 * (56px floor, 10px gap, the radio, a muted 18px medium and the 15px
 * semibold name).
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

function RadioCard({
  value,
  media,
  className,
  children,
  ...props
}: React.ComponentProps<'label'> & {
  value: string
  /** Optional muted medium between the radio and the name; icons take 18px. */
  media?: React.ReactNode
}) {
  return (
    <>
      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Base UI radio
          inside renders the native input this label controls */}
      <label
        data-slot="radio-card"
        className={cn(
          'flex min-h-14 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 text-body shadow-1 select-none',
          cardHoverableClass,
          className,
        )}
        {...props}
      >
        <Radio value={value} />
        {media !== undefined && (
          <span
            data-slot="radio-card-media"
            className="shrink-0 text-muted-foreground [&_svg:not([class*='size-'])]:size-[18px]"
          >
            {media}
          </span>
        )}
        {/* The prototype's card name: onboarding.html sets 15px on `.title`. */}
        <span data-slot="radio-card-name" className="text-[15px] leading-snug font-semibold">
          {children}
        </span>
      </label>
    </>
  )
}

export { Radio, RadioCard, RadioGroup }
