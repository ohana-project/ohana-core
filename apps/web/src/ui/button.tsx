import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/*
 * Ohana button (docs/design/README.md, "Components"): 44px default, one
 * primary per viewport, press moves it down 1px. Focus uses the global
 * :focus-visible outline. The text sizes are the prototype's own values
 * (15px, sm 14px, lg 16.5px — .btn/.btn-sm/.btn-lg), not type-scale
 * steps; the link's 8px side padding rides a compound variant so it
 * lands after the size's padding and wins the merge (.btn-link); the
 * round icon buttons come in 44px (icon) and 36px (icon-sm,
 * .btn-icon.btn-sm).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent bg-clip-padding text-[15px] font-medium tracking-[-0.005em] whitespace-nowrap transition-[background,border-color,transform,box-shadow] duration-(--t-fast) ease-(--ease) select-none active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-accent-strong',
        secondary:
          'border-border bg-card text-foreground shadow-1 hover:border-[color-mix(in_oklch,var(--fg)_30%,var(--border))] aria-expanded:border-[color-mix(in_oklch,var(--fg)_30%,var(--border))]',
        ghost: 'text-foreground hover:bg-accent aria-expanded:bg-accent',
        destructive:
          'bg-(--danger-tint) text-destructive hover:bg-(--danger-tint-hover) focus-visible:border-destructive/40',
        link: 'rounded-sm text-primary hover:underline hover:underline-offset-3',
      },
      size: {
        default: 'min-h-11 px-5 py-2.5',
        sm: 'min-h-9 px-3.5 py-1.5 text-[14px]',
        lg: 'w-full min-h-[52px] px-5 text-[16.5px]',
        icon: 'size-11 rounded-full p-0',
        'icon-sm': 'size-9 rounded-full p-0',
      },
    },
    compoundVariants: [
      // after the size classes, so the link keeps its 8px sides (.btn-link)
      { variant: 'link', class: 'px-2 py-2.5' },
    ],
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'primary',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
