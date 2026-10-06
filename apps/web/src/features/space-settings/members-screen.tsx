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
 * space with their role, one tap from their card. The invite rides the
 * content header below 920px and the top bar from 920px up — the
 * prototype's own button plus its `d-only` top-bar action, kept to one
 * primary per viewport (docs/design/README.md). A regular member sees the
 * same list read-only. The archived members (issue #23) follow in their
 * own section, dimmed: they are out of the space, but their history keeps
 * their name.
 */
export function MembersScreen() {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const profiles = useSpaceProfiles()

  const isOwner = session.me?.member.role === 'owner'
  const all = profiles.data ?? []
  const active = all.filter((profile) => profile.archivedAt === undefined)
  const archived = all.filter((profile) => profile.archivedAt !== undefined)
  const dateFormatter = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'long',
  })

  return (
    <SettingsShell
      title={t('space.members.title')}
      desktopActions={
        isOwner ? (
          <Button size="sm" render={<Link to="/members/invite" />}>
            <Icon name="plus" className="size-4" />
            {t('space.members.invite')}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-7 pt-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-display-lg">{t('space.members.title')}</h1>
            {session.me !== undefined ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {t('space.members.subtitle', { space: session.me.space.name })}
                {profiles.data !== undefined ? (
                  <>
                    {' · '}
                    {t('space.members.activeCount', { active: active.length })}
                    {archived.length > 0 ? (
                      <>
                        {', '}
                        {t('space.members.archivedCount', { count: archived.length })}
                      </>
                    ) : null}
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {isOwner ? (
            // The header's own invite serves the phone; from 920px up the
            // top bar carries it, so one primary invites per viewport.
            <Button className="desktop:hidden" render={<Link to="/members/invite" />}>
              <Icon name="plus" />
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
        ) : all.length === 0 ? (
          <Empty>
            <EmptyMedia>
              <Icon name="users" />
            </EmptyMedia>
            <EmptyTitle>{t('space.members.empty')}</EmptyTitle>
          </Empty>
        ) : (
          <>
            <section>
              <h3 className="mb-2.5 px-1">{t('space.members.activeTitle')}</h3>
              <Card variant="list">
                <ItemGroup>
                  {active.map((profile) => {
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
                        <Avatar hue={hueFromId(profile.id)}>
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
                          {contacts.length > 0 ? (
                            <ItemDescription>{contacts}</ItemDescription>
                          ) : null}
                        </ItemContent>
                        <ItemActions>
                          {/* The pill marks the owner's row only; a regular
                              member's row answers with the chevron alone. */}
                          {profile.role === 'owner' ? (
                            <Badge>{t('admin.space.ownerPill')}</Badge>
                          ) : null}
                          <Icon name="chevron-right" className="text-muted-foreground" />
                        </ItemActions>
                      </Item>
                    )
                  })}
                </ItemGroup>
              </Card>
            </section>

            {archived.length > 0 ? (
              <section>
                <h3 className="mb-2.5 px-1">{t('space.members.archivedTitle')}</h3>
                <Card variant="list">
                  <ItemGroup>
                    {archived.map((profile) => {
                      const displayName = profile.displayName ?? profile.name
                      const archivedAt = profile.archivedAt
                      return (
                        <Item
                          key={profile.id}
                          size="lg"
                          className="opacity-72"
                          render={
                            <Link
                              to="/members/$memberId"
                              params={{ memberId: profile.id }}
                              aria-label={t('space.members.openCard', { name: displayName })}
                            />
                          }
                        >
                          <Avatar hue={hueFromId(profile.id)}>
                            <AvatarFallback>{monogramOf(displayName)}</AvatarFallback>
                          </Avatar>
                          <ItemContent>
                            <ItemTitle>{displayName}</ItemTitle>
                            <ItemDescription>
                              {archivedAt === undefined
                                ? null
                                : t('space.members.archivedRowSub', {
                                    date: dateFormatter.format(new Date(archivedAt)),
                                  })}
                            </ItemDescription>
                          </ItemContent>
                          <ItemActions>
                            <Badge variant="neutral">{t('space.members.archivedPill')}</Badge>
                            <Icon name="chevron-right" className="text-muted-foreground" />
                          </ItemActions>
                        </Item>
                      )
                    })}
                  </ItemGroup>
                </Card>
                <p className="mt-2.5 px-1 text-sm text-muted-foreground">
                  {t('space.members.archivedHint')}
                </p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </SettingsShell>
  )
}
