# Ohana roadmap

This is the release direction agreed during product discovery, not a dated delivery commitment. Implementation specifications and work items belong in GitHub Issues; technical decisions belong in `docs/adr/`, and domain terms belong in `CONTEXT.md`.

## Version 1.0

- Adult couples as the initial audience, with the ability to invite additional adult relatives; a private installation can host several spaces for its operator's family circles.
- Independent accounts in each space, with separately retained sign-ins and account switching on a device.
- Code reissuance restores the same account with all its data; simultaneous sign-in on several devices is supported with simple session controls.
- Shared journal, calendar, and wishlist.
- Journal entries with text and attached images; only the author can edit a published entry.
- Original images are retained, with separate smaller derivatives for viewing.
- Authors can remove their own journal entries and owners can remove shared entries, initially into a recoverable trash state. Retention defaults to 30 days, is configurable by the instance administrator, and shows the permanent-deletion date. Removing a member retains their published history and attribution.
- Journal entries move between draft, published, and trashed states; a published entry does not return to draft.
- Personal journal drafts and private gift favorites.
- Each member maintains personal wishes visible to the space; other members can privately bookmark gift ideas, reserve a wish (hidden from its author), and the author can mark a wish as received.
- Removing a member archives them: sessions and codes are revoked, published history stays, wishes are hidden, and private state is purged after the trash retention period unless an owner restores the member first.
- Calendar reminders through Web Push, with external push delivery accepted; neutral notification text by default and an optional per-device setting for event details.
- Event creators choose reminder recipients individually or select everyone. Each event supports one configurable reminder. Calendar events may occur once or repeat daily, weekly, monthly, or yearly.
- Repeating events support changing one occurrence or the whole series. Timed events retain their time zone and display in the device's local zone; all-day dates do not shift.
- Read-only offline access to automatically synchronized journal text, calendar, and wishlist data, plus cached image previews. Original photographs are not automatically downloaded in bulk.
- Visible connectivity and synchronization states, last successful sync time, and retry feedback, including during sign-in. Cached information remains readable while refreshing or offline.
- Separate instance-administrator and owner responsibilities; both can issue access codes within their administrative scope.
- v1.0 member roles are owner and regular; the instance administrator is separate and not a member of any space. A child role follows later.
- Access codes use a dedicated PostgreSQL table with hashed values, issuer and target-account references, lifecycle status, timestamps, 24-hour expiry, and one-time redemption.
- Member sessions use Secure, HttpOnly, SameSite cookies, one per retained sign-in on a device.
- Multiple owners may administer the same space.
- Only the instance administrator creates new spaces.
- A separate administrative area with its own login manages spaces, their accounts, roles, and codes; an administrator enters the member experience through a separately created member in that space.
- First administrator bootstrap comes from deployment configuration; subsequent administrative access uses the stored password verifier.
- All v1.0 image uploads go through the API; direct browser access to object storage is deferred. The bundled RustFS node can be replaced by any S3-compatible store.
- PostgreSQL access uses Drizzle ORM and Drizzle Kit migrations.
- The web client is a static React SPA (Vite, TanStack Router, TanStack Query); the API contract is published as OpenAPI from TypeBox schemas.
- Offline data synchronises by per-space revision with tombstones.
- Licensed under AGPL-3.0.
- Account onboarding collects an optional display name, email, and phone; email and phone are informational profile fields only and are visible to members in the same space.
- Owners can hide or show Journal, Calendar, and Wishlist without deleting their data.
- The standard deployment exposes the API under `/api/` on the same origin as web.
- PWA as the primary client, with a domain or subdomain using HTTPS as the standard deployment.
- Russian and English localization; each member's language is stored on the server for notification text.
- Prebuilt amd64 and arm64 images on GHCR for each tagged release, installed with the release's pinned Compose file; migrations apply automatically on upgrade.
- On iOS, sign-in offers Home Screen installation first so the access code is redeemed in the installed app.

## Version 1.1

- Document storage and loyalty cards.
- Explicit Save offline actions for documents on each device, with a visible explanation and availability status.

## Version 1.2

- Relationship-duration counters and messages to the future.

## Version 1.3

- Shared photo albums.

## Version 1.4

- Daily tasks.

## Version 1.5

- Shared savings tracker.

## Later roadmap

- High priority: hosting for unrelated families, with a separately reviewed privacy and operational model.
- Child participation and configurable access restrictions.
- All built-in backup and restoration capabilities, both local and remote; their design is deferred. Telegram is a possible future remote-backup option.
- Editing this and all following occurrences of a recurring event.
- Further sharing controls beyond shared content, personal drafts, and private gift favorites.
- Native iOS and Android clients; repository organization to be revisited when this work becomes concrete.
- Simplified Chinese localization.
- Rate limiting of access-code redemption, together with hosting for unrelated families.
- Calendar export and synchronisation with Google and Apple calendars.

## Version 1.0 decisions still open

- Implementation-level cache budgets and cleanup within the accepted offline-reading and synchronization-status behavior.

## Delivery sequence

Resolve the product and architecture questions, then build the project and deployment foundation using the backend decision in [ADR-0003](docs/adr/0003-typescript-fastify-backend.md). Treat the dashboard design system as a separate work item before implementing the agreed feature slices.

Keep version 1.0 account and security workflows simple. Interface details belong in the later design work rather than expanding the architecture interview into an advanced security feature set.
