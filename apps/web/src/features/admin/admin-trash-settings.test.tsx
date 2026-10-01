import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/data/api.ts'
import { renderWithProviders } from '@/testing/render.tsx'
import { AdminTrashSettings } from './admin-trash-settings.tsx'

/*
 * The trash retention form (issue #16): the administrator reads the saved
 * retention, changes it among the prototype's choices, and saves; the save
 * carries the marker header the way every state-changing administrative
 * request does (the hook adds it).
 */

vi.mock('@/data/api.ts', () => ({
  api: { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() },
}))

const apiGet = vi.mocked(api.GET)
const apiPut = vi.mocked(api.PUT)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('AdminTrashSettings', () => {
  it('shows the saved retention among the choices', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/admin/settings') {
        return {
          data: { trashRetentionDays: 30 },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<AdminTrashSettings />)

    const select = (await screen.findByLabelText('Хранить удалённые записи')) as HTMLSelectElement
    expect(select.value).toBe('30')
    const options = [...select.options].map((option) => option.text)
    expect(options).toEqual(['7 дней', '14 дней', '30 дней', '90 дней'])
  })

  it('saves a changed retention with its days, and re-probes the saved value', async () => {
    let savedDays = 30
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/admin/settings') {
        return {
          data: { trashRetentionDays: savedDays },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    apiPut.mockImplementation(
      async (path: never, opts?: { body: { trashRetentionDays: number } }) => {
        if (path === '/api/v1/admin/settings') {
          savedDays = opts?.body.trashRetentionDays ?? savedDays
          return {
            data: { trashRetentionDays: savedDays },
            error: undefined,
            response: new Response(null, { status: 200 }),
          }
        }
        throw new Error(`Unexpected PUT ${String(path)}`)
      },
    )
    const user = userEvent.setup()
    renderWithProviders(<AdminTrashSettings />)

    const select = (await screen.findByLabelText('Хранить удалённые записи')) as HTMLSelectElement
    await user.selectOptions(select, '7')
    await user.click(screen.getByRole('button', { name: 'Сохранить срок' }))

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith(
        '/api/v1/admin/settings',
        expect.objectContaining({ body: { trashRetentionDays: 7 } }),
      ),
    )
    expect(await screen.findByText('Срок хранения обновлён')).toBeInTheDocument()
    // The form follows the saved value again, and the save goes dark.
    await waitFor(() => expect(select.value).toBe('7'))
  })

  it('shows a saved value outside the prototype choices as the saved one', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/admin/settings') {
        return {
          data: { trashRetentionDays: 45 },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<AdminTrashSettings />)

    const select = (await screen.findByLabelText('Хранить удалённые записи')) as HTMLSelectElement
    expect(select.value).toBe('45')
    const options = [...select.options].map((option) => Number(option.value))
    expect(options).toEqual([7, 14, 30, 45, 90])
    // Picking a prototype choice must not erase the saved one from the
    // list before the save lands.
    const user = userEvent.setup()
    await user.selectOptions(select, '14')
    expect([...select.options].map((option) => Number(option.value))).toEqual([7, 14, 30, 45, 90])
  })

  it('keeps the save dark while nothing changed', async () => {
    apiGet.mockImplementation(async (path: never) => {
      if (path === '/api/v1/admin/settings') {
        return {
          data: { trashRetentionDays: 30 },
          error: undefined,
          response: new Response(null, { status: 200 }),
        }
      }
      throw new Error(`Unexpected GET ${String(path)}`)
    })
    renderWithProviders(<AdminTrashSettings />)

    expect(await screen.findByRole('button', { name: 'Сохранить срок' })).toBeDisabled()
    expect(apiPut).not.toHaveBeenCalled()
  })
})
