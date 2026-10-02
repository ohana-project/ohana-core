/*
 * Wall-time composition over the runtime's IANA database (issue #20). The
 * calendar stores a timed event as the absolute start and end instants plus
 * the IANA zone the event keeps; the wire carries the wall time the creator
 * picked (a date, a start and an end time), so the server composes one from
 * the other. Node's Intl is the only authority the runtime has — there is
 * no zoneinfo library — and this module wraps it behind functions the tests
 * exercise directly, DST boundaries included.
 */

const ZONE_PARTS_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
}

/**
 * The zone's offset at `instant`, in seconds east of UTC. The wall time the
 * zone shows at the instant, read back as if it were UTC, is the instant
 * shifted by exactly this offset.
 */
export function zoneOffsetSeconds(zone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...ZONE_PARTS_OPTIONS,
    timeZone: zone,
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)
    if (part === undefined) throw new Error(`The zone lookup produced no ${type}`)
    return Number(part.value)
  }
  const asUtc = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  )
  return (asUtc - instant.getTime()) / 1000
}

/**
 * The absolute instant of a wall time in a zone: `date` is `YYYY-MM-DD`,
 * `time` is `HH:MM`. Two passes, because the offset to subtract is itself a
 * function of the instant: the first guess reads the offset at the naive
 * UTC reading, the second corrects it at the guessed instant — which is
 * what an ordinary (non-transition) wall time needs, and a deterministic
 * answer for the two peculiar kinds. A wall time inside a spring-forward
 * gap does not exist; it maps to the moment the gap ends at the same wall
 * reading shifted forward (the convention date pickers follow). A wall time
 * a fall-back repeats maps to its first occurrence, the earlier instant,
 * keeping the event where a viewer living there first expects it.
 */
export function wallTimeToInstant(date: string, time: string, zone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(naive)) {
    throw new Error(`“${date}T${time}” is not a wall time`)
  }
  const guessed = naive - zoneOffsetSeconds(zone, new Date(naive)) * 1000
  return new Date(naive - zoneOffsetSeconds(zone, new Date(guessed)) * 1000)
}

export interface WallTime {
  date: string
  time: string
}

/** The wall time a zone shows at `instant` — the editor's fields when an event is edited. */
export function instantToWallTime(instant: Date, zone: string): WallTime {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
}
