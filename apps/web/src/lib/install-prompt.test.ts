import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installPromptAvailable,
  promptInstall,
  subscribeToInstallPrompt,
} from './install-prompt.ts'

/*
 * The capture lives at the app entry, not inside any screen: the event can
 * fire wherever the visitor happens to be. These tests exercise the store
 * without mounting anything. It is a page-lifetime singleton, so each test
 * leaves it empty through the appinstalled reset.
 */

function fireBeforeInstallPrompt(prompt?: () => Promise<void>) {
  const event = new Event('beforeinstallprompt')
  if (prompt !== undefined) Object.assign(event, { prompt })
  window.dispatchEvent(event)
}

afterEach(() => {
  window.dispatchEvent(new Event('appinstalled'))
})

describe('install prompt store', () => {
  it('captures the deferred event without any screen mounted', () => {
    expect(installPromptAvailable()).toBe(false)

    fireBeforeInstallPrompt(vi.fn(async () => {}))

    expect(installPromptAvailable()).toBe(true)
  })

  it('ignores an event without a prompt payload', () => {
    fireBeforeInstallPrompt()

    expect(installPromptAvailable()).toBe(false)
  })

  it('notifies subscribers when the event arrives and is spent', () => {
    const seen: boolean[] = []
    const stop = subscribeToInstallPrompt(() => seen.push(installPromptAvailable()))

    fireBeforeInstallPrompt(vi.fn(async () => {}))
    promptInstall()

    expect(seen).toEqual([true, false])
    stop()
  })

  it('spends the event safely when nothing was captured', () => {
    expect(() => promptInstall()).not.toThrow()
    expect(installPromptAvailable()).toBe(false)
  })
})
