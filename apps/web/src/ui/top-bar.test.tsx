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
    { initials: 'А', hue: 60 },
    { initials: 'Д', hue: 145 },
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
