import { useTranslation } from 'react-i18next'
import type { StoredWish } from '@/data/local-store.ts'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Icon } from '@/ui/icon.tsx'
import { chipDomainParts } from './wishlist-entries.ts'

/**
 * One wish row (the prototypes' wish card, issue #18): the received mark
 * strikes the title out, the details and the link's domain chip travel
 * under the title, and the author's rows carry the edit button — only the
 * author can change a wish, so only their screens offer the way to.
 */
export function WishRow({
  wish,
  editable = false,
  onEdit,
}: {
  wish: StoredWish
  editable?: boolean
  onEdit?: () => void
}) {
  const { t } = useTranslation()
  const received = wish.receivedAt !== undefined
  const chip = wish.link !== undefined ? chipDomainParts(wish.link) : undefined
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {received && (
            <span className="w-fit">
              <Badge variant="ok">{t('wishlist.receivedPill')}</Badge>
            </span>
          )}
          {/* break-words: a title of the contract's 200 characters, or a
              detail with no space in it, must wrap instead of overflowing. */}
          <span
            className={`break-words text-h3 ${received ? 'text-muted-foreground line-through' : ''}`}
          >
            {wish.title}
          </span>
          {wish.details !== undefined && (
            <span className="text-sm break-words text-muted-foreground">{wish.details}</span>
          )}
          {wish.link !== undefined && (
            <a
              href={wish.link}
              target="_blank"
              rel="noopener noreferrer"
              // The full target stays reachable: the chip's text may be
              // cut, the tooltip never is.
              title={wish.link}
              className="inline-flex w-fit max-w-full items-center gap-1.5 text-sm text-accent hover:underline"
            >
              <Icon name="globe" className="size-4 shrink-0" />
              <span className="flex min-w-0 items-baseline">
                {/* The head yields first; the tail, the hostname's last
                    two labels, never does. */}
                <span className="min-w-0 truncate">{chip?.head}</span>
                <span className="shrink-0">{chip?.tail}</span>
              </span>
            </a>
          )}
        </div>
        {editable && (
          <Button variant="ghost" size="icon" aria-label={t('wishlist.edit')} onClick={onEdit}>
            <Icon name="edit" />
          </Button>
        )}
      </div>
    </Card>
  )
}
