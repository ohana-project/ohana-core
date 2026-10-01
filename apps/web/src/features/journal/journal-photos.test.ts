import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/api-error.ts'
import {
  deleteEntryImage,
  entryImageUrl,
  fetchEntryImage,
  uploadEntryImage,
} from './journal-photos.ts'

/*
 * The photos' data access (issue #17): the bytes stream from the authorised
 * API with the active member's header, one fetch per photo per session (the
 * object URL is remembered), and the API's error codes surface as ApiError
 * for the screens to translate.
 */

const ME = '01900000-0000-7000-8000-000000000001'

function seedActiveMember(memberId: string): void {
  window.localStorage.setItem(
    'ohana.sessions',
    JSON.stringify([{ memberId, spaceId: 'space-1', spaceName: 'Наша семья', name: 'Аня' }]),
  )
  window.localStorage.setItem('ohana.activeMember', memberId)
}

function fetchResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  seedActiveMember(ME)
  // jsdom has no blob store; the tests only need a stable fake handle.
  URL.createObjectURL = vi.fn(() => `blob:photo-${Math.random()}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchEntryImage', () => {
  it('fetches through the API naming the member, and remembers the answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['bytes']), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const first = await fetchEntryImage('entry-1', 'image-1', 'feed')
    const second = await fetchEntryImage('entry-1', 'image-1', 'feed')

    expect(first).toMatch(/^blob:/)
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(entryImageUrl('entry-1', 'image-1', 'feed'))
    expect((init.headers as Record<string, string>)['x-ohana-member']).toBe(ME)
    expect(init.credentials).toBe('same-origin')
  })

  it('maps a refusal to the API error code it carries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fetchResponse({ error: { code: 'image_not_found' } }, 404)),
    )
    await expect(fetchEntryImage('entry-1', 'gone', 'feed')).rejects.toMatchObject({
      code: 'image_not_found',
    })
  })
})

describe('uploadEntryImage', () => {
  it('posts the file as one multipart upload naming the member', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(fetchResponse({ id: 'image-9', state: 'processing' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const file = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' })
    const image = await uploadEntryImage('entry-1', file)

    expect(image).toEqual({ id: 'image-9', state: 'processing' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/journal/entries/entry-1/images')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('file')).toBeInstanceOf(File)
    expect((init.headers as Record<string, string>)['x-ohana-member']).toBe(ME)
  })

  it('surfaces the refusal codes: the limit, the type, a stranger', async () => {
    const cases: Array<[number, unknown, string]> = [
      [413, { error: { code: 'image_too_large' } }, 'image_too_large'],
      [415, { error: { code: 'unsupported_image_type' } }, 'unsupported_image_type'],
      [409, { error: { code: 'image_limit_reached' } }, 'image_limit_reached'],
      [404, { error: { code: 'entry_not_found' } }, 'entry_not_found'],
    ]
    for (const [status, body, code] of cases) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse(body, status)))
      await expect(uploadEntryImage('entry-1', new File(['x'], 'p.jpg'))).rejects.toMatchObject({
        code,
      })
    }
    expect.assertions(cases.length)
  })
})

describe('deleteEntryImage', () => {
  it('sends the removal and answers nothing on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    await deleteEntryImage('entry-1', 'image-1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/journal/entries/entry-1/images/image-1')
    expect(init.method).toBe('DELETE')
  })

  it('maps the refusal of a member who is not the author', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(fetchResponse({ error: { code: 'author_required' } }, 403)),
    )
    await expect(deleteEntryImage('entry-1', 'image-1')).rejects.toBeInstanceOf(ApiError)
  })
})
