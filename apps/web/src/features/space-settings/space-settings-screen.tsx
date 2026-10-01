import { Navigate } from '@tanstack/react-router'
import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { timezoneOptions } from '@/lib/timezones.ts'
import { Button } from '@/ui/button.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Field, FieldDescription, FieldLabel } from '@/ui/field.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'
import { SettingsShell } from './settings-shell.tsx'
import {
  spaceSettingsErrorMessage,
  useMemberSpace,
  useUpdateTimezone,
} from './use-space-settings.ts'

/*
 * The space settings (docs/design/screens/space-settings.html): the space's
 * default time zone for new events, changeable by an owner (issue #12,
 * story 40). Section visibility arrives with its own ticket; renaming stays
 * with the instance administrator.
 */
export function SpaceSettingsScreen() {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const space = useMemberSpace()
  const updateTimezone = useUpdateTimezone()

  const zones = useMemo(
    () => timezoneOptions(i18n.language as 'ru' | 'en', new Date()),
    [i18n.language],
  )
  const [timezone, setTimezone] = useState<string | undefined>(undefined)

  if (session.me !== undefined && session.me.member.role !== 'owner') {
    // The settings are an owner instrument; a regular member goes home.
    return <Navigate to="/" replace />
  }

  const current = space.data
  const effectiveTimezone = timezone ?? current?.timezone ?? 'UTC'
  const dirty = current !== undefined && timezone !== undefined && timezone !== current.timezone

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (updateTimezone.isPending || !dirty) return
    updateTimezone.mutate(
      { timezone: effectiveTimezone },
      {
        onSuccess: () => {
          setTimezone(undefined)
          toast(t('space.settings.savedToast'))
        },
        onError: (error) => toast(spaceSettingsErrorMessage(error, t), 'danger'),
      },
    )
  }

  return (
    <SettingsShell title={t('space.settings.title')}>
      <div className="flex flex-col gap-6 pt-6">
        <header>
          <h1 className="text-display-lg">{t('space.settings.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {current !== undefined
              ? t('space.settings.subtitle', { space: current.name })
              : t('ui.loading')}
          </p>
        </header>

        {space.isPending ? (
          <div className="grid place-items-center py-10">
            <Spinner className="size-6" />
          </div>
        ) : space.isError ? (
          <div className="pt-2">
            <ErrorState onRetry={() => void space.refetch()} />
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <section>
              <SectionHeader title={t('space.settings.timezoneSection')} />
              <Field>
                <FieldLabel htmlFor="space-settings-timezone">
                  {t('space.settings.timezoneLabel')}
                </FieldLabel>
                <Select
                  id="space-settings-timezone"
                  value={effectiveTimezone}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {zones.map((zone) => (
                    <option key={zone.value} value={zone.value}>
                      {zone.label}
                    </option>
                  ))}
                </Select>
                <FieldDescription>{t('space.settings.timezoneHint')}</FieldDescription>
              </Field>
            </section>
            <Button type="submit" size="lg" disabled={!dirty || updateTimezone.isPending}>
              {t('space.settings.save')}
            </Button>
            <p className="px-1 text-sm text-muted-foreground">{t('space.settings.syncNote')}</p>
          </form>
        )}
      </div>
    </SettingsShell>
  )
}
