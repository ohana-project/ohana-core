import type * as React from 'react'
import { cn } from '@/lib/cn'

/*
 * Ohana access-code input (`.code-input` + the prototype's формат
 * rule): one text input that formats to XXXX-XXXX while typing —
 * Latin letters and digits only, uppercase, 8 characters. Pasting a
 * whole code just works; there are no segmented boxes.
 */

export function formatAccessCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned
}

export interface AccessCodeInputProps
  extends Omit<React.ComponentProps<'input'>, 'onChange' | 'value' | 'defaultValue' | 'type'> {
  defaultValue?: string
  invalid?: boolean
  /** Receives the cleaned 8-character code (or a prefix while typing). */
  onValueChange?: (value: string) => void
  /** Fires on the first input after `invalid`, so the field can clear the error. */
  onInvalidClear?: () => void
}

export function AccessCodeInput({
  defaultValue = '',
  invalid = false,
  onValueChange,
  onInvalidClear,
  className,
  ...props
}: AccessCodeInputProps) {
  const handleInput = (event: React.FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const formatted = formatAccessCode(input.value)
    input.value = formatted
    onValueChange?.(formatted.replace(/-/g, ''))
    if (invalid) {
      onInvalidClear?.()
    }
  }

  return (
    <input
      type="text"
      data-slot="code-input"
      defaultValue={formatAccessCode(defaultValue)}
      onInput={handleInput}
      autoComplete="one-time-code"
      autoCapitalize="characters"
      spellCheck={false}
      inputMode="text"
      aria-invalid={invalid || undefined}
      className={cn(
        'min-h-[68px] w-full rounded-lg border-[1.5px] border-border bg-card px-4 py-3 text-center font-mono text-[30px] font-medium tracking-[0.18em] uppercase tabular-nums text-foreground outline-none transition-[border-color,box-shadow] duration-(--t-fast) ease-(--ease) placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-primary-soft focus-visible:outline-none aria-invalid:border-destructive group-data-[invalid=true]/field:animate-shake',
        className,
      )}
      {...props}
    />
  )
}
