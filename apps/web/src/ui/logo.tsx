import { useId } from 'react'
import { cn } from '@/lib/cn'

/*
 * The Ohana mark: five petals and a heart, ink on rose, on a plate
 * (docs/design/README.md, "Iconography"). Ported from the prototype's
 * LOGO_MARK and LOGO_ROUND in docs/design/assets/ohana.js; the brand
 * hexes here are the allowed exception to the token rule. The round
 * variant with the thicker stroke is for small sizes like the top bar.
 */

const PETAL =
  'M0 0C-19 0-62.5-44-62.5-104C-62.5-144-34.5-176 0-176C34.5-176 62.5-144 62.5-104C62.5-44 19 0 0 0Z'
const PETAL_TURNS = [0, 72, 144, 216, 288]
const HEART =
  'M0 30C-8 24-34 8-34-10c0-13 10-22 21-22 6 0 10 3 13 8 3-5 7-8 13-8 11 0 21 9 21 22C34 8 8 24 0 30Z'

interface FlowerProps {
  petalStrokeWidth: number
  heartScale: number
  withOverlap: boolean
  clipId: string
}

function Flower({ petalStrokeWidth, heartScale, withOverlap, clipId }: FlowerProps) {
  return (
    <g
      transform="translate(257 267.5)"
      fill="var(--ohana-rose)"
      stroke="var(--ohana-ink)"
      strokeWidth={petalStrokeWidth}
      strokeLinejoin="round"
    >
      {PETAL_TURNS.map((turn) => (
        <path key={turn} d={PETAL} transform={`rotate(${turn}) translate(-28 -18) rotate(15)`} />
      ))}
      {withOverlap && (
        <g clipPath={`url(#${clipId})`}>
          <path d={PETAL} transform="translate(-28 -18) rotate(15)" />
        </g>
      )}
      <path d={HEART} transform={`scale(${heartScale})`} />
    </g>
  )
}

interface LogoProps {
  /** Rendered size in px; defaults to the parent's font size (1em). */
  size?: number
  className?: string
}

/** The mark on its rounded square plate — the app icon and large lockups. */
export function LogoMark({ size, className }: LogoProps) {
  const clipId = useId()
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn(!size && 'size-[1em]', className)}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="-256" y="-256" width="256" height="256" />
        </clipPath>
      </defs>
      <g transform="scale(0.046875)">
        <rect width="512" height="512" rx="120" fill="var(--ohana-rose)" />
        <Flower petalStrokeWidth={16.5} heartScale={1.2} withOverlap clipId={clipId} />
      </g>
    </svg>
  )
}

/** The round-plate variant for small sizes (top bar, user menu button). */
export function LogoRound({ size, className }: LogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn(!size && 'size-[1em]', className)}
    >
      <g transform="scale(0.046875)">
        <circle cx="256" cy="256" r="256" fill="var(--ohana-rose)" />
        <Flower petalStrokeWidth={21} heartScale={1.3} withOverlap={false} clipId="" />
      </g>
    </svg>
  )
}

/**
 * The wordmark lockup (`.logo` in the prototype): mark plus serif
 * "Ohana", used on auth screens and the admin top bar.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-foreground', className)}>
      <LogoMark className="size-[34px]" />
      <span className="font-display text-[22px] leading-none font-semibold tracking-[-0.01em]">
        Ohana
      </span>
    </span>
  )
}
