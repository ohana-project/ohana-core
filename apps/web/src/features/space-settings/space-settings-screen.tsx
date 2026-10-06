import { Navigate } from '@tanstack/react-router'
import { type FormEvent, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMemberSessionStatus } from '@/features/member/use-member-session.ts'
import { timezoneOptions } from '@/lib/timezones.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { ErrorState } from '@/ui/error-state.tsx'
import { Field, FieldDescription, FieldLabel } from '@/ui/field.tsx'
import { Icon, type IconName } from '@/ui/icon.tsx'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/ui/item.tsx'
import { SectionHeader } from '@/ui/section-header.tsx'
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { Switch } from '@/ui/switch.tsx'
import { toast } from '@/ui/toast.tsx'
import { SettingsShell } from './settings-shell.tsx'
import {
  type MemberSpace,
  spaceSettingsErrorMessage,
  useMemberSpace,
  useSectionVisibility,
  useUpdateSections,
  useUpdateTimezone,
} from './use-space-settings.ts'

/*
 * The space settings (docs/design/screens/space-settings.html): the
 * sections an owner shows or hides (issue #13, ADR-0011) and the space's
 * default time zone for new events (issue #12, story 40). Hiding keeps the
 * section's data; the section leaves every member's navigation until it is
 * shown again. Renaming stays with the instance administrator.
 */

type SpaceSections = MemberSpace['sections']

const SECTION_ROWS: readonly {
  id: keyof SpaceSections
  icon: IconName
  labelKey: 'nav.journal' | 'nav.calendar' | 'nav.wishlist'
  onKey:
    | 'space.settings.sectionJournalOn'
    | 'space.settings.sectionCalendarOn'
    | 'space.settings.sectionWishlistOn'
}[] = [
  {
    id: 'journal',
    icon: 'book',
    labelKey: 'nav.journal',
    onKey: 'space.settings.sectionJournalOn',
  },
  {
    id: 'calendar',
    icon: 'calendar',
    labelKey: 'nav.calendar',
    onKey: 'space.settings.sectionCalendarOn',
  },
  {
    id: 'wishlist',
    icon: 'gift',
    labelKey: 'nav.wishlist',
    onKey: 'space.settings.sectionWishlistOn',
  },
]

export function SpaceSettingsScreen() {
  const { t, i18n } = useTranslation()
  const session = useMemberSessionStatus()
  const space = useMemberSpace()
  const updateTimezone = useUpdateTimezone()
  const updateSections = useUpdateSections()
  // Unknown means visible: the one default comes from the shared hook, so
  // the switches read the same truth the navigation does.
  const serverVisibility = useSectionVisibility()

  const zones = useMemo(
    () => timezoneOptions(i18n.language as 'ru' | 'en', new Date()),
    [i18n.language],
  )
  const [timezone, setTimezone] = useState<string | undefined>(undefined)
  // The switches hold the attempted state so they respond instantly; once a
  // mutation settles it is dropped, and the server's answer (the query
  // invalidation refetch) is the truth underneath.
  const [sections, setSections] = useState<SpaceSections | undefined>(undefined)

  if (session.me !== undefined && session.me.member.role !== 'owner') {
    // The settings are an owner instrument; a regular member goes home.
    return <Navigate to="/" replace />
  }

  const current = space.data
  const effectiveTimezone = timezone ?? current?.timezone ?? 'UTC'
  const dirty = current !== undefined && timezone !== undefined && timezone !== current.timezone
  const visibility = sections ?? serverVisibility

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

  const toggleSection = (id: keyof SpaceSections, next: boolean) => {
    if (updateSections.isPending) return
    setSections({ ...visibility, [id]: next })
    updateSections.mutate(
      { sections: { [id]: next } },
      {
        onSuccess: () =>
          toast(
            next ? t('space.settings.sectionShownToast') : t('space.settings.sectionHiddenToast'),
          ),
        onError: (error) => toast(spaceSettingsErrorMessage(error, t), 'danger'),
        // The attempted state hands control back once the mutation has
        // settled: the hook-level invalidation refetched first, so the
        // server's answer is what the switches show either way.
        onSettled: () => setSections(undefined),
      },
    )
  }

  return (
    <SettingsShell title={t('space.settings.shortTitle')}>
      <div className="flex flex-col pt-5">
        <header className="mb-5.5">
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
          <>
            <div className="flex flex-col gap-6.5">
              <section>
                <SectionHeader level={3} title={t('space.settings.sectionsSection')} />
                <Card variant="list">
                  <ItemGroup>
                    {SECTION_ROWS.map((row) => (
                      <Item key={row.id} size="md">
                        {/* The prototype's bare 20px muted leading icon —
                            no tile (issue #77). */}
                        <ItemMedia>
                          <Icon name={row.icon} />
                        </ItemMedia>
                        <ItemContent>
                          <ItemTitle>{t(row.labelKey)}</ItemTitle>
                          <ItemDescription>
                            {visibility[row.id]
                              ? t(row.onKey)
                              : t('space.settings.sectionHiddenSub')}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Switch
                            checked={visibility[row.id]}
                            onCheckedChange={(checked) => toggleSection(row.id, checked)}
                            disabled={updateSections.isPending}
                            aria-label={t('space.settings.sectionShowSwitch', {
                              section: t(row.labelKey),
                            })}
                          />
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </Card>
                <p className="mt-2.5 px-1 text-meta text-muted-foreground">
                  {t('space.settings.sectionsHint')}
                </p>
              </section>

              <form onSubmit={submit} noValidate className="flex flex-col gap-5">
                <section>
                  <SectionHeader level={3} title={t('space.settings.timezoneSection')} />
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
              </form>
            </div>

            <p className="mt-6 px-1 font-mono text-meta text-muted-foreground uppercase">
              {t('space.settings.syncNote')}
            </p>
          </>
        )}
      </div>
    </SettingsShell>
  )
}
