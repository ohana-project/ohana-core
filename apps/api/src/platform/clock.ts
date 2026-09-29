export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

export interface FixedClock extends Clock {
  advance(millis: number): void
}

export function fixedClock(start: Date = new Date('2026-01-01T00:00:00.000Z')): FixedClock {
  let current = start.getTime()
  return {
    now: () => new Date(current),
    advance: (millis: number) => {
      current += millis
    },
  }
}
