import { Navigate, useNavigate } from '@tanstack/react-router'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { writeClipboard } from '@/lib/clipboard.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { CodeDisplay } from '@/ui/code-display.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog.tsx'
import { Empty, EmptyMedia, EmptyTitle } from '@/ui/empty.tsx'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/ui/field.tsx'
import { Icon } from '@/ui/icon.tsx'
import { Input } from '@/ui/input.tsx'
import { NoteBlock } from '@/ui/note-block.tsx'
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { ToggleGroup, ToggleGroupItem } from '@/ui/toggle-group.tsx'
import { SettingsShell } from './settings-shell.tsx'
import {
  CONTACT_MIN_LENGTH,
  type IssuedAccessCode,
  spaceSettingsErrorMessage,
  useIssueMemberAccessCode,
  useProvisionSpaceMember,
} from './use-space-settings.ts'

/*
 * The invite screen (docs/design/screens/invite.html): an owner provisions
 * a member and is handed their access code — shown once, copied or read
 * aloud, never stored anywhere but the owner's eyes (issue #12). Rerolling
 * replaces the code; the member and their data are untouched (ADR-0005).
 * The code step is the prototype's own (issue #77): the padded card capped
 * at 420px, the large labelled copy over the secondary reroll, the note
 * block and the closing mono line.
 */
export function InviteMemberScreen() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const session = useMemberSessionStatus()

  const provisionMember = useProvisionSpaceMember()
  const issueCode = useIssueMemberAccessCode()

  const [name, setName] = useState('')
  const [role, setRole] = useState<'owner' | 'regular'>('regular')
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [interfaceLanguage, setInterfaceLanguage] = useState<'' | 'ru' | 'en'>('')
  const [nameError, setNameError] = useState<string | undefined>()
  const [emailError, setEmailError] = useState<string | undefined>()
  const [phoneError, setPhoneError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | undefined>()
  // The member the code is being handed to, and the code itself: the whole
  // reason this screen exists. `provisioned` switches to the code display.
  const [provisioned, setProvisioned] = useState<{ memberId: string; name: string } | undefined>()
  const [issued, setIssued] = useState<IssuedAccessCode | undefined>()
  const [rerollOpen, setRerollOpen] = useState(false)

  if (session.me !== undefined && session.me.member.role !== 'owner') {
    // The invite screen is an owner instrument; a regular member who lands
    // here goes back to the read-only list.
    return <Navigate to="/members" replace />
  }

  const issue = (memberId: string) => {
    setFormError(undefined)
    issueCode.mutate(
      { memberId },
      {
        onSuccess: (result) => {
          setIssued(result)
          // A reroll's dialog has said its goodbyes: the fresh code shows
          // right here.
          setRerollOpen(false)
          toast(t('space.invite.issuedToast', { code: result.code }))
        },
        onError: (error) => {
          // A failed reroll joins the code on the page: the dialog must not
          // sit over its own error.
          setRerollOpen(false)
          setFormError(spaceSettingsErrorMessage(error, t))
        },
      },
    )
  }

  const copyIssued = async () => {
    // The clipboard may be absent or refuse; the code stays selectable.
    if (issued === undefined) return
    if (await writeClipboard(issued.code)) {
      // The prototype's toast says where the code goes.
      toast(t('space.invite.copiedToast', { code: issued.code }))
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (provisionMember.isPending || issueCode.isPending) return
    const failures: { name?: string; email?: string; phone?: string } = {}
    if (name.trim().length === 0) failures.name = t('space.invite.nameRequired')
    if (email.trim().length > 0 && [...email.trim()].length < CONTACT_MIN_LENGTH) {
      failures.email = t('space.invite.tooShort', { count: CONTACT_MIN_LENGTH })
    }
    if (phone.trim().length > 0 && [...phone.trim()].length < CONTACT_MIN_LENGTH) {
      failures.phone = t('space.invite.tooShort', { count: CONTACT_MIN_LENGTH })
    }
    setNameError(failures.name)
    setEmailError(failures.email)
    setPhoneError(failures.phone)
    setFormError(undefined)
    if (
      failures.name !== undefined ||
      failures.email !== undefined ||
      failures.phone !== undefined
    ) {
      return
    }
    provisionMember.mutate(
      {
        name: name.trim(),
        role,
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        interfaceLanguage: interfaceLanguage === '' ? undefined : interfaceLanguage,
      },
      {
        onSuccess: (member) => {
          setProvisioned({ memberId: member.id, name: member.name })
          issue(member.id)
        },
        onError: (error) => setFormError(spaceSettingsErrorMessage(error, t)),
      },
    )
  }

  if (provisioned !== undefined) {
    return (
      <SettingsShell title={t('space.invite.shortTitle')} backTo="/members">
        <div className="flex flex-col pt-8">
          <header className="mb-6 flex flex-col items-center text-center">
            <span className="mb-3.5 grid size-16 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Icon name="users" className="size-7" />
            </span>
            <h1 className="text-display-lg">{t('space.invite.codeTitle')}</h1>
            <p className="mt-1.5 text-body text-muted-foreground">
              {t('space.invite.codeDescription', { name: provisioned.name })}
            </p>
          </header>

          {issued === undefined && issueCode.isError ? (
            // The member exists but the code never arrived: retry issuance —
            // resubmitting the whole form would create a duplicate member.
            // No prototype covers this step (docs/design/README.md).
            // The empty state stands bare (README "Cards") — no card around it.
            <>
              <Empty>
                <EmptyMedia>
                  <Icon name="alert" />
                </EmptyMedia>
                <EmptyTitle>{formError ?? t('space.errors.unexpected')}</EmptyTitle>
              </Empty>
              <div className="mt-4.5 flex flex-col gap-2.5">
                <Button onClick={() => issue(provisioned.memberId)} disabled={issueCode.isPending}>
                  <Icon name="repeat" />
                  {t('space.invite.retryIssue')}
                </Button>
                <Button variant="secondary" onClick={() => void navigate({ to: '/members' })}>
                  {t('space.invite.done')}
                </Button>
              </div>
            </>
          ) : issued === undefined ? (
            <div className="grid place-items-center py-10">
              <Spinner className="size-6" />
            </div>
          ) : (
            <>
              <Card variant="padded" className="mx-auto w-full max-w-[420px]">
                {/* The code is copied from the large primary below; the
                    beside-button would double it (issue #77). */}
                <CodeDisplay code={issued.code} copy="none" />
                <p className="mt-2.5 text-center font-mono text-meta text-muted-foreground uppercase">
                  {t('space.invite.expiresMeta')}
                </p>
                <div className="mt-4.5 flex flex-col gap-2.5">
                  <Button size="lg" onClick={() => void copyIssued()}>
                    <Icon name="copy" />
                    {t('space.invite.copy')}
                  </Button>
                  <Button variant="secondary" onClick={() => setRerollOpen(true)}>
                    <Icon name="repeat" />
                    {t('space.invite.reroll')}
                  </Button>
                </div>
                {formError !== undefined ? (
                  <p className="mt-2.5 text-sm text-destructive">{formError}</p>
                ) : null}
              </Card>

              <NoteBlock icon="shield" className="mx-auto mt-4.5 w-full max-w-[420px]">
                <p className="leading-normal">
                  <b>{t('space.invite.noteLead')}</b>
                  {t('space.invite.noteRest')}
                </p>
              </NoteBlock>

              <p className="mt-6.5 text-center font-mono text-meta text-muted-foreground uppercase">
                {t('space.invite.footer')}
              </p>
            </>
          )}
        </div>

        {rerollOpen ? (
          // A mid-flight reroll owns the dialog: it cannot be dismissed
          // until the request settles, so the callbacks land on a visible
          // dialog.
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next && !issueCode.isPending) setRerollOpen(false)
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('space.invite.rerollTitle')}</DialogTitle>
                <DialogDescription>
                  {t('space.invite.rerollText', { code: issued?.code ?? '' })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="secondary"
                  disabled={issueCode.isPending}
                  onClick={() => setRerollOpen(false)}
                >
                  {t('ui.cancel')}
                </Button>
                <Button onClick={() => issue(provisioned.memberId)} disabled={issueCode.isPending}>
                  {t('space.invite.rerollConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </SettingsShell>
    )
  }

  return (
    <SettingsShell title={t('space.invite.shortTitle')} backTo="/members">
      <div className="flex flex-col gap-6 pt-6">
        <header>
          <h1 className="text-display-lg">{t('space.invite.title')}</h1>
          <p className="mt-1 text-body text-muted-foreground">{t('space.invite.description')}</p>
        </header>

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field data-invalid={nameError !== undefined || undefined}>
            <FieldLabel htmlFor="invite-member-name">{t('space.invite.nameLabel')}</FieldLabel>
            <Input
              id="invite-member-name"
              value={name}
              maxLength={200}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(undefined)
                setFormError(undefined)
              }}
            />
            {nameError !== undefined ? <FieldError>{nameError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>{t('space.invite.roleLabel')}</FieldLabel>
            <ToggleGroup
              value={[role]}
              onValueChange={(value) => {
                const next = value.at(-1)
                if (next === 'owner' || next === 'regular') setRole(next)
              }}
            >
              <ToggleGroupItem value="regular">{t('space.invite.roleRegular')}</ToggleGroupItem>
              <ToggleGroupItem value="owner">{t('space.invite.roleOwner')}</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          <p className="text-meta font-mono text-muted-foreground uppercase">
            {t('space.invite.profileTitle')}
          </p>
          <Field>
            <FieldLabel htmlFor="invite-member-display-name">
              {t('space.invite.displayNameLabel')}
            </FieldLabel>
            <Input
              id="invite-member-display-name"
              value={displayName}
              maxLength={200}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </Field>
          <Field data-invalid={emailError !== undefined || undefined}>
            <FieldLabel htmlFor="invite-member-email">{t('space.invite.emailLabel')}</FieldLabel>
            <Input
              id="invite-member-email"
              type="email"
              value={email}
              maxLength={200}
              onChange={(event) => {
                setEmail(event.target.value)
                setEmailError(undefined)
                setFormError(undefined)
              }}
            />
            {emailError !== undefined ? <FieldError>{emailError}</FieldError> : null}
          </Field>
          <Field data-invalid={phoneError !== undefined || undefined}>
            <FieldLabel htmlFor="invite-member-phone">{t('space.invite.phoneLabel')}</FieldLabel>
            <Input
              id="invite-member-phone"
              type="tel"
              value={phone}
              maxLength={40}
              onChange={(event) => {
                setPhone(event.target.value)
                setPhoneError(undefined)
                setFormError(undefined)
              }}
            />
            {phoneError !== undefined ? <FieldError>{phoneError}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="invite-member-language">
              {t('space.invite.languageLabel')}
            </FieldLabel>
            <Select
              id="invite-member-language"
              value={interfaceLanguage}
              onChange={(event) => setInterfaceLanguage(event.target.value as '' | 'ru' | 'en')}
            >
              <option value="">—</option>
              <option value="ru">{t('language.ru')}</option>
              <option value="en">{t('language.en')}</option>
            </Select>
            <FieldDescription>{t('space.invite.languageHint')}</FieldDescription>
          </Field>

          {formError !== undefined ? <FieldError>{formError}</FieldError> : null}
          <Button
            type="submit"
            size="lg"
            disabled={provisionMember.isPending || issueCode.isPending}
          >
            {provisionMember.isPending || issueCode.isPending ? <Spinner /> : null}
            {t('space.invite.submit')}
          </Button>
          <FieldDescription>{t('space.invite.shownOnce')}</FieldDescription>
        </form>
      </div>
    </SettingsShell>
  )
}
