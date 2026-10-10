import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/data/api-error.ts'
import { forgetFetchedImages, peekFetchedImage } from '@/lib/photo-cache.ts'
import { FakeUploadRequest } from '@/testing/fake-upload.ts'
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
 * for the screens to translate. The upload rides XMLHttpRequest so the
 * editor's ring can show the bytes' real progress (issue #71).
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
  FakeUploadRequest.instances = []
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

  it('refuses and revokes a blob whose session ended before the fetch landed', async () => {
    let resolveFetch: (response: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )
    const pending = fetchEntryImage('entry-1', 'late', 'feed')
    // The sign-out lands while the fetch is in flight.
    forgetFetchedImages()
    resolveFetch(new Response(new Blob(['bytes']), { status: 200 }))

    await expect(pending).rejects.toThrow('the session ended')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(expect.stringMatching(/^blob:/))
    expect(peekFetchedImage(entryImageUrl('entry-1', 'late', 'feed'))).toBeUndefined()
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
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)

    const file = new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' })
    const pending = uploadEntryImage('entry-1', file)
    const request = FakeUploadRequest.instances.at(-1)
    if (request === undefined) throw new Error('the upload request was never sent')
    request.respond(201, { id: 'image-9', state: 'processing' })

    await expect(pending).resolves.toEqual({ id: 'image-9', state: 'processing' })
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/api/v1/journal/entries/entry-1/images')
    expect(request.body).toBeInstanceOf(FormData)
    expect(request.body?.get('file')).toBeInstanceOf(File)
    expect(request.headers['x-ohana-member']).toBe(ME)
  })

  it('reports the bytes’ progress while the upload runs', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)

    const fractions: number[] = []
    const pending = uploadEntryImage(
      'entry-1',
      new File(['jpeg-bytes'], 'photo.jpg', { type: 'image/jpeg' }),
      (fraction) => fractions.push(fraction),
    )
    const request = FakeUploadRequest.instances.at(-1)
    if (request === undefined) throw new Error('the upload request was never sent')
    request.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 })
    request.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 })
    // An event without a known total carries no honest fraction.
    request.upload.onprogress?.({ lengthComputable: false, loaded: 100, total: 0 })
    request.respond(201, { id: 'image-9', state: 'ready' })

    await pending
    expect(fractions).toEqual([0.4, 1])
  })

  it('surfaces the refusal codes: the limit, the type, a stranger', async () => {
    const cases: Array<[number, unknown, string]> = [
      [413, { error: { code: 'image_too_large' } }, 'image_too_large'],
      [415, { error: { code: 'unsupported_image_type' } }, 'unsupported_image_type'],
      [409, { error: { code: 'image_limit_reached' } }, 'image_limit_reached'],
      [404, { error: { code: 'entry_not_found' } }, 'entry_not_found'],
    ]
    for (const [status, body, code] of cases) {
      vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)
      const pending = uploadEntryImage('entry-1', new File(['x'], 'p.jpg'))
      FakeUploadRequest.instances.at(-1)?.respond(status, body)
      await expect(pending).rejects.toMatchObject({ code })
    }
    expect.assertions(cases.length)
  })

  it('answers the unexpected error when the request never leaves', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)

    const pending = uploadEntryImage('entry-1', new File(['x'], 'p.jpg'))
    const request = FakeUploadRequest.instances.at(-1)
    if (request === undefined) throw new Error('the upload request was never sent')
    request.onerror?.()

    await expect(pending).rejects.toMatchObject({ code: 'unexpected' })
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
