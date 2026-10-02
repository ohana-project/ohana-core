/*
 * The push half of the service worker (issue #22), imported by the
 * generated worker (vite.config.ts, workbox.importScripts). The worker
 * composes the text — neutral or with the event's details, in the
 * recipient's language — this script only shows it and opens the calendar
 * on a tap. It is written in plain script: it is imported into the
 * generated bundle, not built by Vite.
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    // An unreadable payload still has to answer the push service with a
    // visible notification (userVisibleOnly), so a placeholder shows.
  }
  const title =
    typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : 'Ohana'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      data: { url: typeof payload.url === 'string' ? payload.url : '/calendar' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus()
        }
      }
      const known = clients.find((client) => 'focus' in client)
      if (known !== undefined) {
        // An installed app opens where the member left it; a deep link
        // would fight the router on a cold start.
        return known.focus()
      }
      await self.clients.openWindow(url)
    })(),
  )
})
