import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { adminErrorMessage } from '@/features/admin/use-admin-session.ts'
import { useAdminSettings, useAdminUpdateSettings } from '@/features/admin/use-admin-settings.ts'
import { Button } from '@/ui/button.tsx'
import { Card } from '@/ui/card.tsx'
import { Field, FieldDescription, FieldLabel } from '@/ui/field.tsx'
import { Select } from '@/ui/select.tsx'
import { Spinner } from '@/ui/spinner.tsx'
import { toast } from '@/ui/toast.tsx'

/*
 * The trash retention (docs/design/screens/admin-settings.html, "Корзина",
 * issue #16): how long a trashed entry is kept before the worker purges
 * it. The prototype's four choices are the picker's options; the contract
 * itself accepts any whole number of days from 1 to 365. The hint keeps
 * only the promise this installation makes — the prototype's per-space
 * schedule line is a known defect, recorded in docs/design/README.md.
 */

const RETENTION_CHOICES = [7, 14, 30, 90]

export function AdminTrashSettings() {
  const { t } = useTranslation()
  const settings = useAdminSettings()
  const update = useAdminUpdateSettings()
  const [selectedDays, setSelectedDays] = useState<number | undefined>(undefined)

  // The select follows the saved value until the administrator changes it.
  useEffect(() => {
    if (settings.data !== undefined && selectedDays === undefined) {
      setSelectedDays(settings.data.trashRetentionDays)
    }
  }, [settings.data, selectedDays])

  // The prototype's choices drive the picker, but a value set outside it —
  // the contract accepts 1 to 365 — must still display as the saved one.
  const choices =
    selectedDays !== undefined && !RETENTION_CHOICES.includes(selectedDays)
      ? [...RETENTION_CHOICES, selectedDays].sort((a, b) => a - b)
      : RETENTION_CHOICES

  const save = () => {
    if (selectedDays === undefined) return
    update.mutate(
      { trashRetentionDays: selectedDays },
      { onSuccess: () => toast(t('admin.settings.trashSavedToast')) },
    )
  }

  if (settings.isPending) {
    return (
      <section className="flex flex-col gap-2.5">
        <h3 className="px-1">{t('admin.settings.trashTitle')}</h3>
        <Card>
          <div className="grid place-items-center py-8">
            <Spinner className="size-6" />
          </div>
        </Card>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="px-1">{t('admin.settings.trashTitle')}</h3>
      <Card>
        <Field>
          <FieldLabel htmlFor="admin-trash-retention">
            {t('admin.settings.trashRetentionLabel')}
          </FieldLabel>
          <Select
            id="admin-trash-retention"
            value={selectedDays === undefined ? undefined : String(selectedDays)}
            onChange={(event) => setSelectedDays(Number(event.target.value))}
          >
            {choices.map((days) => (
              <option key={days} value={days}>
                {t('admin.settings.trashRetentionOption', { days })}
              </option>
            ))}
          </Select>
          <FieldDescription>{t('admin.settings.trashRetentionHint')}</FieldDescription>
        </Field>
        <div className="mt-3.5 flex items-center gap-2.5">
          <Button
            onClick={save}
            disabled={
              update.isPending ||
              selectedDays === undefined ||
              selectedDays === settings.data?.trashRetentionDays
            }
          >
            {t('admin.settings.trashRetentionSave')}
          </Button>
          {update.isError ? (
            <span className="text-sm text-destructive">{adminErrorMessage(update.error, t)}</span>
          ) : null}
        </div>
      </Card>
    </section>
  )
}
