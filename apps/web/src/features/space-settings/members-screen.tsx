import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { useSpaceProfiles } from '@/features/member/use-space-profiles.ts'
import { hueFromId, monogramOf } from '@/lib/monogram.ts'
import { Avatar, AvatarFallback } from '@/ui/avatar.tsx'
import { Badge } from '@/ui/badge.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Empty, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Icon } from '@/ui/icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/ui/item.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { SettingsShell } from './settings-shell.tsx'

/*
 * The space members (docs/design/screens/members.html): every member of the
 * space with their role, one tap from their card. The invite action and the
 * per-member management belong to an owner (issue #12); a regular member
 * sees the same list read-only. Archiving arrives with its own ticket.
 */
export function MembersScreen() {
  const { t } = useTranslation()
  const session = useMemberSessionStatus()
  const profiles = useSpaceProfiles()

  const isOwner = session.me?.member.role === 'owner'

  return (
    <SettingsShell title={t('space.members.title')}>
      <div className="flex flex-col gap-6 pt-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-display-lg">{t('space.members.title')}</h1>
            {session.me !== undefined ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t('space.members.subtitle', { space: session.me.space.name })}
              </p>
            ) : null}
          </div>
          {isOwner ? (
            <Button render={<Link to="/members/invite" />}>
              <Icon name="plus" className="size-4" />
              {t('space.members.invite')}
            </Button>
          ) : null}
        </header>

        {profiles.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : profiles.isError ? (
          <ErrorState onRetry={() => void profiles.refetch()} />
        ) : profiles.data.length === 0 ? (
          <Card>
            <Empty>
              <EmptyMedia>
                <Icon name="users" />
              </EmptyMedia>
              <EmptyTitle>{t('space.members.empty')}</EmptyTitle>
            </Empty>
          </Card>
        ) : (
          <Card className="py-0">
            <ItemGroup>
              {profiles.data.map((profile) => {
                const displayName = profile.displayName ?? profile.name
                const isSelf = profile.id === session.me?.member.id
                const contacts = [profile.email, profile.phone].filter(Boolean).join(' · ')
                return (
                  <Item
                    key={profile.id}
                    size="lg"
                    render={
                      <Link
                        to="/members/$memberId"
                        params={{ memberId: profile.id }}
                        aria-label={t('space.members.openCard', { name: displayName })}
                      />
                    }
                  >
                    <Avatar size="sm" hue={hueFromId(profile.id)}>
                      <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
                    </Avatar>
                    <ItemContent>
                      <ItemTitle>
                        {displayName}
                        {isSelf ? (
                          <span className="font-normal text-muted-foreground">
                            {' '}
                            · {t('space.members.you')}
                          </span>
                        ) : null}
                      </ItemTitle>
                      {contacts.length > 0 ? <ItemDescription>{contacts}</ItemDescription> : null}
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={profile.role === 'owner' ? 'primary' : 'neutral'}>
                        {profile.role === 'owner'
                          ? t('admin.space.ownerPill')
                          : t('admin.space.regularPill')}
                      </Badge>
                      <Icon name="chevron-right" className="size-4 text-muted-foreground" />
                    </ItemActions>
                  </Item>
                )
              })}
            </ItemGroup>
          </Card>
        )}
        {isOwner ? (
          <p className="px-1 text-sm text-muted-foreground">{t('admin.space.lastOwnerNote')}</p>
        ) : null}
      </div>
    </SettingsShell>
  )
}
