import type { Locale } from '@ohana/i18n'

/**
 * The IANA zones the runtime knows, as select options labelled like the
 * prototypes: «Новосибирск (UTC+7)». The offset is the zone's current one —
 * good enough to tell zones apart in a picker; the stored value is the
 * IANA name itself.
 */
export interface TimezoneOption {
  value: string
  label: string
}

function currentOffset(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: zone,
    timeZoneName: 'shortOffset',
  }).formatToParts(now)
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'UTC'
  return name.replace('GMT', 'UTC')
}

function cityOf(zone: string): string {
  const tail = zone.split('/').at(-1) ?? zone
  return tail.replaceAll('_', ' ')
}

export function timezoneOptions(locale: Locale, now: Date): TimezoneOption[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']
  if (!zones.includes('UTC')) zones.push('UTC')
  return zones
    .map((zone) => {
      const offset = currentOffset(zone, now)
      return { value: zone, offset, label: `${cityOf(zone)} (${offset})` }
    })
    .sort(
      (a, b) =>
        offsetMinutes(a.offset) - offsetMinutes(b.offset) || a.label.localeCompare(b.label, locale),
    )
}

/** Turns an offset like «UTC+5:30» into minutes east of UTC for sorting. */
function offsetMinutes(offset: string): number {
  const match = /^UTC([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset)
  if (match === null) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0))
}
