/*
 * Wall-time composition over the runtime's IANA database. A section module
 * hands a member-picked wall time (a date, a start and an end time) and an
 * IANA zone to these helpers and stores the absolute instants they answer;
 * Node's Intl is the only zone authority the runtime has — there is no
 * zoneinfo library — so this module wraps it behind functions the tests
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

// One formatter per zone: constructing one is the expensive part of the
// lookup, and the composition runs inside the transaction that holds the
// space row lock.
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(zone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { ...ZONE_PARTS_OPTIONS, timeZone: zone })
    zoneFormatters.set(zone, formatter)
  }
  return formatter
}

/**
 * The zone's offset at `instant`, in seconds east of UTC. The wall time the
 * zone shows at the instant, read back as if it were UTC, is the instant
 * shifted by exactly this offset.
 */
export function zoneOffsetSeconds(zone: string, instant: Date): number {
  const parts = zoneFormatter(zone).formatToParts(instant)
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

const DAY_MS = 86_400_000

/**
 * The absolute instant of a wall time in a zone: `date` is `YYYY-MM-DD`,
 * `time` is `HH:MM`. The offset to subtract is itself a function of the
 * instant, so the candidates are composed with the offsets a day before
 * and a day after and kept when their own zone reading round-trips to the
 * wall time asked for. When both survive, the wall time is one a fall-back
 * repeats and the earlier instant wins — the first occurrence, where a
 * viewer living there first expects the event. When neither survives, the
 * wall time sits inside a spring-forward gap and does not exist; the
 * pre-transition offset lands past the gap, and that shifted-forward
 * moment — the convention date pickers follow — is the answer.
 */
export function wallTimeToInstant(date: string, time: string, zone: string): Date {
  const naive = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(naive)) {
    throw new Error(`“${date}T${time}” is not a wall time`)
  }
  const before = zoneOffsetSeconds(zone, new Date(naive - DAY_MS)) * 1000
  const after = zoneOffsetSeconds(zone, new Date(naive + DAY_MS)) * 1000
  const real = [naive - before, naive - after].filter(
    (candidate) => zoneOffsetSeconds(zone, new Date(candidate)) * 1000 === naive - candidate,
  )
  return new Date(real.length > 0 ? Math.min(...real) : naive - before)
}
