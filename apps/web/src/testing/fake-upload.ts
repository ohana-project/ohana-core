/**
 * A minimal XMLHttpRequest standing in for the photo upload: the code
 * under test drives it through open/setRequestHeader/send, the test
 * answers through the same handlers a browser would fire. Stub it over
 * the global (`vi.stubGlobal('XMLHttpRequest', FakeUploadRequest)`) and
 * read the last instance to respond or to fire upload progress.
 */
export class FakeUploadRequest {
  static instances: FakeUploadRequest[] = []

  readonly upload: {
    onprogress:
      | ((event: { lengthComputable: boolean; loaded: number; total: number }) => void)
      | null
  } = { onprogress: null }

  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = 0
  responseText = ''
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: FormData | undefined = undefined

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value
  }

  send(body: FormData): void {
    this.body = body
    FakeUploadRequest.instances.push(this)
  }

  /** The browser's answer, as the browser delivers it. */
  respond(status: number, body: unknown): void {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}
