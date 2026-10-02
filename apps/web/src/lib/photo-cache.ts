/**
 * The name of the service worker's cache of journal photo derivatives
 * (issue #17): the feed and viewer images a member has viewed are kept for
 * offline reading. The name is shared between the build (vite.config's
 * workbox runtime caching) and the runtime (a sign-out deletes the cache
 * whole — the previews are the one cached API response, and they must not
 * outlive the session that viewed them).
 */
export const JOURNAL_PHOTO_CACHE = 'journal-photos'
