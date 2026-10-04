import type { Page } from '@playwright/test'

/*
 * The computed fill of a colour token, probed the same way for every
 * spec: a throwaway span paints the token as its background and the
 * computed colour comes back — the same serialisation a component's
 * background-color reports, colour-mix fills included. A token that no
 * longer resolves would read transparent and make every comparison
 * vacuous, so the helper refuses it.
 */
export async function tokenFill(page: Page, token: string): Promise<string> {
  const colour = await page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = `var(${name})`
    document.body.append(probe)
    const computed = getComputedStyle(probe).backgroundColor
    probe.remove()
    return computed
  }, token)
  if (colour === 'rgba(0, 0, 0, 0)') {
    throw new Error(`token ${token} did not resolve to a colour`)
  }
  return colour
}
