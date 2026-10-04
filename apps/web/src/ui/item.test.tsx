import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/testing/render.tsx'
import { Avatar } from '@/ui/avatar.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/ui/item.tsx'

/*
 * The list row against the prototype (issue #58): the heights the
 * prototypes use inline (52, 56, 60, 64, 68px) as size variants, a
 * bare leading icon by default, and the 38px tinted tile only when
 * `variant="icon"` opts into it — so an avatar never sits on a tinted
 * square. The min-height values are asserted against computed styles
 * in e2e/design.spec.ts.
 */
const SIZES = ['sm', 'default', 'md', 'lg', 'xl'] as const

describe('Item', () => {
  it('offers every height the prototypes use', () => {
    renderWithProviders(
      <>
        {SIZES.map((size) => (
          <Item key={size} size={size} data-testid={size}>
            <ItemContent>
              <ItemTitle>Строка</ItemTitle>
            </ItemContent>
          </Item>
        ))}
      </>,
    )
    for (const size of SIZES) {
      expect(screen.getByTestId(size), `size ${size}`).toHaveAttribute('data-size', size)
    }
  })

  it('keeps the prototype padding, gap and title weight by default', () => {
    renderWithProviders(
      <Item data-testid="row">
        <ItemMedia>
          <Icon name="book" />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Строка</ItemTitle>
        </ItemContent>
      </Item>,
    )
    const row = screen.getByTestId('row')
    expect(row.className).toContain('px-3.5')
    expect(row.className).toContain('py-2.5')
    expect(row.className).toContain('gap-3.5')
  })
})

describe('ItemMedia', () => {
  it('is bare by default: no tinted square behind the leading icon', () => {
    renderWithProviders(
      <Item>
        <ItemMedia data-testid="media">
          <Icon name="book" />
        </ItemMedia>
      </Item>,
    )
    const media = screen.getByTestId('media')
    expect(media).toHaveAttribute('data-variant', 'default')
    expect(media).not.toHaveAttribute('data-tone')
    expect(media.className).not.toContain('bg-surface-2')
    expect(media.className).not.toContain('size-[38px]')
  })

  it('the 38px tinted tile is opt-in through variant icon, tinted by the tone', () => {
    renderWithProviders(
      <Item>
        <ItemMedia variant="icon" tone="warn" data-testid="media">
          <Icon name="cake" />
        </ItemMedia>
      </Item>,
    )
    const media = screen.getByTestId('media')
    expect(media).toHaveAttribute('data-variant', 'icon')
    expect(media).toHaveAttribute('data-tone', 'warn')
    expect(media.className).toContain('size-[38px]')
    expect(media.className).toContain('bg-(--warn-fill)')
  })

  it('a tone on a bare icon colours it without a tile behind it', () => {
    renderWithProviders(
      <Item>
        <ItemMedia tone="primary" data-testid="media">
          <Icon name="heart" />
        </ItemMedia>
      </Item>,
    )
    const media = screen.getByTestId('media')
    expect(media).toHaveAttribute('data-variant', 'default')
    expect(media).toHaveAttribute('data-tone', 'primary')
    // the tone's colour wins over the bare default, and no tile comes
    // with it
    expect(media.className).toContain('text-primary')
    expect(media.className).not.toContain('text-muted-foreground')
    expect(media.className).not.toContain('size-[38px]')
    expect(media.className).not.toContain('bg-')
  })

  it('keeps the neutral tile for variant icon without a tone', () => {
    renderWithProviders(
      <Item>
        <ItemMedia variant="icon" data-testid="media">
          <Icon name="clock" />
        </ItemMedia>
      </Item>,
    )
    const media = screen.getByTestId('media')
    expect(media).toHaveAttribute('data-variant', 'icon')
    expect(media).toHaveAttribute('data-tone', 'neutral')
    expect(media.className).toContain('bg-surface-2')
  })

  it('an avatar as leading content has no tinted square behind it', () => {
    renderWithProviders(
      <Item>
        <ItemMedia data-testid="media">
          <Avatar hue={60}>А</Avatar>
        </ItemMedia>
      </Item>,
    )
    const media = screen.getByTestId('media')
    expect(media.className).not.toContain('bg-surface-2')
    expect(media.className).not.toContain('bg-(--')
    expect(screen.getByText('А')).toBeVisible()
  })
})
