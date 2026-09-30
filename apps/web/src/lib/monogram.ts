/**
 * Monograms for spaces and members: the first letter of a name on a warm
 * per-entity hue (docs/design/README.md, "Avatars"). Real data has no
 * hand-picked hues, so the hue derives deterministically from the row's id.
 */
export function monogramOf(name: string): string {
  const first = name.trim()[0] ?? '·'
  return first.toLocaleUpperCase()
}

export function hueFromId(id: string): number {
  let hash = 0
  for (const character of id) {
    const code = character.codePointAt(0) ?? 0
    hash = (hash * 31 + code) % 360
  }
  return hash
}
