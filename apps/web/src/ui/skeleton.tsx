import { cn } from '@/lib/cn'

/*
 * Ohana skeleton (`.skel` in the prototype): shimmering surface-2.
 * The shimmer stops under prefers-reduced-motion via the base reset.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'animate-shimmer rounded-md bg-surface-2 [background-image:linear-gradient(100deg,var(--surface-2)_40%,color-mix(in_oklch,var(--surface-2)_55%,var(--surface))_50%,var(--surface-2)_60%)] [background-size:200%_100%]',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
