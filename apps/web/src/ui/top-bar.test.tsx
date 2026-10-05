import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import type { ShellUserMenuItem } from '@/ui/shell.ts'
import { TopBar } from '@/ui/top-bar.tsx'

/*
 * The top bar's user menu (docs/design/README.md, "Overlays"): 42px items
 * in the order they are handed over, with the prototype's hairline
 * separators where an item asks for one — the grouping of the user menu
 * (issue #63) is the builder's decision, the rendering is the shell's.
 */

const SPACE = {
  name: 'Наша семья',
  membersLabel: '4 участника · вы владелец',
  marks: [
    { id: 'anya', initials: 'А', hue: 60 },
    { id: 'dima', initials: 'Д', hue: 145 },
  ],
}

function renderTopBar(items: ShellUserMenuItem[]) {
  return renderWithProviders(<TopBar title="Главная" space={SPACE} userMenuItems={items} />)
}

describe('TopBar user menu', () => {
  it('renders the items in order with the asked-for separators', async () => {
    const user = userEvent.setup()
    renderTopBar([
      { id: 'profile', label: 'Профиль', icon: 'user' },
      {
        id: 'theme',
        label: 'Тема',
        icon: 'moon',
        ariaLabel: 'Тёмная тема',
        separatorBefore: true,
      },
      { id: 'switch-space', label: 'Сменить пространство', icon: 'repeat' },
      { id: 'sign-out', label: 'Выйти', icon: 'log-out', separatorBefore: true },
    ])

    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))

    // The menu mounts into a portal; the popup's own children carry the
    // order: items and hairlines alternate exactly as the prototype's
    // «Профиль | Тема, Сменить пространство | Выйти» grouping asks.
    const slots = await screen
      .findByRole('menu')
      .then((menu) =>
        [...menu.querySelectorAll('[data-slot]')].map(
          (node) => node.getAttribute('data-slot') as string,
        ),
      )
    expect(slots).toEqual([
      'dropdown-menu-item',
      'dropdown-menu-separator',
      'dropdown-menu-item',
      'dropdown-menu-item',
      'dropdown-menu-separator',
      'dropdown-menu-item',
    ])
    // An item's aria-label becomes its accessible name (the theme item
    // names the theme it leads to); the visible label is unchanged.
    expect(screen.getByRole('menuitem', { name: 'Тёмная тема' })).toHaveTextContent('Тема')
    expect(screen.getByRole('menuitem', { name: 'Сменить пространство' })).toBeInTheDocument()
  })

  it('draws no separator when no item asks for one', async () => {
    const user = userEvent.setup()
    renderTopBar([
      { id: 'members', label: 'Участники', icon: 'users' },
      { id: 'sign-out', label: 'Выйти', icon: 'log-out' },
    ])

    await user.click(screen.getByRole('button', { name: 'Меню пользователя' }))

    await screen.findByRole('menuitem', { name: 'Участники' })
    expect(screen.queryByRole('menuitem', { name: 'Тема' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(0)
  })
})

describe('TopBar shell chrome (issue #62)', () => {
  it('carries the mobile bottom hairline and the desktop border colour', () => {
    renderWithProviders(<TopBar title="Главная" space={SPACE} />)

    const bar = document.querySelector('[data-slot="topbar"]')
    expect(bar).not.toBeNull()
    // the prototype's .topbar: a 1px fg-8% hairline below 920px, the
    // border token from 920px up (assets/ohana.css, .topbar)
    expect(bar?.className).toContain('border-b')
    expect(bar?.className).toContain('border-[color-mix(in_oklch,var(--fg)_8%,transparent)]')
    expect(bar?.className).toContain('desktop:border-border')
  })

  it('the space switcher hugs the monogram stack, with the prototype’s -6px margins', () => {
    renderWithProviders(<TopBar title="Главная" space={SPACE} />)

    const switcher = document.querySelector('[data-slot="topbar-space"]')
    expect(switcher).not.toBeNull()
    // .topbar .topbar-space { width: auto; padding: 0 6px; margin: 0 -6px }
    // on the 44px icon button — the button is as wide as its stack
    expect(switcher?.className).toContain('h-11')
    expect(switcher?.className).toContain('w-auto')
    expect(switcher?.className).toContain('px-1.5')
    expect(switcher?.className).toContain('-mx-1.5')
    expect(switcher?.className).not.toContain('size-11')
  })

  it('the space switcher keeps the 44px round on an empty stack', () => {
    // min-w-11 is the floor the negative margins cannot eat: without a
    // monogram the button would otherwise collapse to its cancelled
    // padding — a focusable nothing (review round three)
    renderWithProviders(<TopBar title="Главная" space={{ ...SPACE, marks: [] }} />)

    const switcher = document.querySelector('[data-slot="topbar-space"]')
    expect(switcher).not.toBeNull()
    expect(switcher?.className).toContain('min-w-11')
    expect(switcher?.querySelector('[data-slot="avatar"]')).toBeNull()
  })

  it('desktop-only actions mount into a slot hidden below 920px', () => {
    renderWithProviders(
      <TopBar
        title="Дневник"
        space={SPACE}
        desktopActions={<button type="button">Новая запись</button>}
      />,
    )

    const slot = document.querySelector('[data-slot="topbar-actions-desktop"]')
    expect(slot).not.toBeNull()
    // the prototype's .d-only: no display below 920px, contents above
    expect(slot?.className).toContain('hidden')
    expect(slot?.className).toContain('desktop:contents')
    expect(screen.getByRole('button', { name: 'Новая запись' })).toBeInTheDocument()
  })

  it('renders no desktop-actions slot when a screen marks none', () => {
    renderWithProviders(<TopBar title="Главная" space={SPACE} />)

    expect(document.querySelector('[data-slot="topbar-actions-desktop"]')).toBeNull()
  })
})
