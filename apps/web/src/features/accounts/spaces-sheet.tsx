import { Link, useNavigate } from '@tanstack/react-router'
import { useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberSignOut, useSwitchMember } from '@/features/member/use-member-session.ts'
import { Avatar } from '@/ui/avatar.tsx'
import { AvatarStack } from '@/ui/avatar-stack.tsx'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog.tsx'
import { Icon } from '@/ui/icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@/ui/item.tsx'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/ui/sheet.tsx'
import { toast } from '@/ui/toast.tsx'
import { useDeviceSpaces } from './use-device-spaces.ts'

/*
 * The «Пространства» sheet (docs/design/screens/home.html's account sheet,
 * issue #64): one row per sign-in on this device — the space's avatar
 * stack, its name, a subtitle and the accent check on the active one —
 * then «Войти по коду» and «Выйти из …» behind the sign-out confirm. The
 * prototype opens the same sheet from three places (the top-bar switcher,
 * the sidebar's and the user menu's «Сменить пространство», all
 * `data-menu="tpl-account"`), so one module store answers for the open
 * state and the sheet itself is mounted once, by the member session gate —
 * the sheet exists exactly where a member session does.
 */

let open = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Opens the sheet; the one entry the switchers and the user menu item call. */
export function openSpacesSheet(): void {
  if (open) return
  open = true
  emit()
}

/** Closes the sheet; the store's own onOpenChange and the tests' reset. */
export function closeSpacesSheet(): void {
  setSpacesSheetOpen(false)
}

function setSpacesSheetOpen(next: boolean): void {
  if (open === next) return
  open = next
  emit()
}

export function SpacesSheet() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isOpen = useSyncExternalStore(subscribe, () => open)
  const spaces = useDeviceSpaces()
  const active = spaces.find((space) => space.active)
  const switchMember = useSwitchMember()
  const signOut = useMemberSignOut()
  const [signOutOpen, setSignOutOpen] = useState(false)

  const choose = (memberId: string) => {
    setSpacesSheetOpen(false)
    // The current row's switch is a no-op — closing is the whole gesture;
    // switching means entering that space, and a deep route of the old
    // member must not outlive the switch (the accounts screen navigates
    // home for the same reason).
    if (memberId === active?.session.memberId) return
    switchMember(memberId)
    void navigate({ to: '/' })
  }

  const signOutActive = () => {
    if (active === undefined) return
    signOut.mutate(active.session.memberId, {
      onSuccess: () => {
        setSignOutOpen(false)
        setSpacesSheetOpen(false)
        toast(t('accounts.signedOut', { space: active.session.spaceName }))
      },
      onError: () => toast(t('accounts.signOutFailed'), 'danger'),
    })
  }

  return (
    <Sheet open={isOpen} onOpenChange={setSpacesSheetOpen}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('accounts.title')}</SheetTitle>
          <SheetDescription>{t('accounts.sheetSubtitle')}</SheetDescription>
        </SheetHeader>
        <Card variant="list">
          <ItemGroup>
            {spaces.map((space) => (
              <Item
                key={space.session.memberId}
                size="sm"
                render={
                  <button
                    type="button"
                    onClick={() => choose(space.session.memberId)}
                    aria-current={space.active ? 'true' : undefined}
                    aria-label={t('accounts.switchToSpace', { space: space.session.spaceName })}
                  />
                }
              >
                <AvatarStack>
                  {space.marks.slice(0, 3).map((mark) => (
                    <Avatar key={mark.id} size="sm" hue={mark.hue}>
                      {mark.initials}
                    </Avatar>
                  ))}
                </AvatarStack>
                <ItemContent>
                  <ItemTitle>{space.session.spaceName}</ItemTitle>
                  <ItemDescription>
                    {space.membersLabel ?? space.session.displayName ?? space.session.name}
                  </ItemDescription>
                </ItemContent>
                {/* the prototype's trailing accent check on the active row
                    (ohana.js, `accountSheetHTML`); the others trail nothing */}
                <ItemActions>
                  {space.active && <Icon name="check" className="text-primary" />}
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </Card>
        <div className="flex flex-col gap-2">
          <Button variant="secondary" render={<Link to="/signin" />}>
            <Icon name="plus" />
            {t('accounts.enterByCode')}
          </Button>
          {active !== undefined && (
            <Button
              variant="ghost"
              className="text-destructive"
              onClick={() => setSignOutOpen(true)}
            >
              <Icon name="log-out" />
              {t('accounts.signOut', { space: active.session.spaceName })}
            </Button>
          )}
        </div>

        {signOutOpen && active !== undefined ? (
          // A mid-flight sign-out owns the dialog: it cannot be dismissed
          // until the request settles, like the accounts screen's.
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next && !signOut.isPending) setSignOutOpen(false)
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {t('accounts.signOutTitle', { space: active.session.spaceName })}
                </DialogTitle>
                <DialogDescription>{t('accounts.signOutText')}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  disabled={signOut.isPending}
                  onClick={() => setSignOutOpen(false)}
                >
                  {t('ui.cancel')}
                </Button>
                <Button variant="destructive" disabled={signOut.isPending} onClick={signOutActive}>
                  {t('accounts.signOutConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
