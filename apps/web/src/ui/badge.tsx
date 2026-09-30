import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from 'cn'

/*
 * Ohana pill (`.pill` in the prototype): mono 11px uppercase on a
 * tinted fill. Variants carry the semantic colours; the tints are the
 * --*-fill tokens the contrast test measures.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 py-[3px] font-mono text-[11px] tracking-[0.04em] uppercase whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-(--accent-fill) text-primary',
        ok: 'bg-(--ok-fill) text-ok',
        warn: 'bg-(--warn-fill) text-warn',
        danger: 'bg-(--danger-fill) text-destructive',
        neutral: 'bg-(--neutral-fill) text-muted-foreground',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
)

function Badge({
  className,
  variant = 'primary',
  render,
  ...props
}: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: 'span',
    props: mergeProps<'span'>(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: 'badge',
      variant,
    },
  })
}

export { Badge, badgeVariants }
