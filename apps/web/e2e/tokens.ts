import type { Page } from '@playwright/test'

/*
 * The computed value of a colour token, probed the same way for every
 * spec: a throwaway span paints the token as its background and the
 * computed colour comes back — the same serialisation a component's
 * background-color reports, colour-mix fills included.
 */
export async function tokenFill(page: Page, token: string): Promise<string> {
  return page.evaluate(([name]) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).backgroundColor
    probe.remove()
    return colour
  }, [token])
}
