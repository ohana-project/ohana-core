# Ohana architecture

This document describes how Ohana's code is organised and how its parts cooperate. ADRs in `docs/adr/` record why decisions were made; this document is the binding blueprint for implementing them. If an implementation needs a different structure, change this document in the same pull request and explain why. Domain terms follow `CONTEXT.md`.

## System at a glance

```
Browser (installed PWA)
   │ HTTPS
   ▼
Caddy (optional) ──► api  (Fastify: /api/v1/* and the static SPA)
                      │            │
                      ▼            ▼
                 PostgreSQL 18   S3 storage (bundled RustFS or external)
                      ▲
                      │ jobs (pg-boss)
                   worker ──► Web Push services
migrate (one-shot, runs before api and worker)
```

api, worker, and migrate are entrypoints of one image and one codebase (`apps/api`). The web client (`apps/web`) is static files served by api.

## Backend (`apps/api`)

### Layout

```
src/
  entrypoints/    server, worker, migrate, admin password reset
  app/            buildApp(deps) and buildWorker(deps): the composition roots
  platform/       config, db, storage, jobs, push, clock, timezone, logging, errors, http plugins
  modules/
    <module>/
      index.ts        public surface: service functions, sync contributor, job handlers
      routes.ts       HTTP routes: schema references and thin handlers
      contracts.ts    TypeBox request and response schemas
      service.ts      use cases and domain rules
      policy.ts       visibility and permission rules shared by reads and sync
      repository.ts   Drizzle queries for this module's tables
      tables.ts       Drizzle table definitions
      jobs.ts         worker handlers, if any
      sync.ts         sync contributor, if the module has synchronised data
      *.test.ts       HTTP and worker tests for this module
  db/migrations/  generated SQL, reviewed like code
```

Modules: `spaces`, `members`, `access`, `admin`, `journal`, `calendar`, `wishlist`, `sync`, `media`, `notifications`. A module is added only for a new domain area, never for a technical concern. The `admin` module owns the instance administrator: bootstrap from deployment configuration, administrative sessions, the administrative password, and the installation's settings (the trash retention today, which the `journal` module reads through `admin`'s public surface). Its `index.ts` also publishes the administrative guards and the marker-header contract schema, because member-facing modules mount the same protection for their own administrative routes. The `access` module owns access codes and member sessions; its `index.ts` publishes the member session guard, the `X-Ohana-Member` header schema, the member-only params schema, and the actor narrowings the same way, because the member-facing routes of other modules mount them: the `members` module (above `access`) imports them directly, while a module below `access` — `spaces`, whose member-facing space-settings routes mount the guard for the owner's default-time-zone change — receives the guard and narrowings through a route-options port that the composition root wires, exactly like the member counter, so the dependency graph stays acyclic. The guard resolves the member's role through a port that the composition root wires to the `members` module, so `access`'s services never import `members`; only its `tables.ts` references the members table for the ADR-0016 keys. The `wishlist` module stands above `members`: a reservation's ending is hidden from one member — the wish's author — so its deletions fan the tombstones out over the space's members, and the members module publishes `listMemberIdsInTx` for that audience, read inside the caller's transaction.

Section visibility is a space setting owned by the `spaces` module: the flags live on the space row, and the module publishes the one section gate that the section modules mount on their routes after the member session guard (ADR-0011). The gate calls the spaces service, whose `policy.ts` owns the visibility rule; a hidden section's reads and writes answer 404 `section_hidden`. A section write use case also rechecks visibility inside its transaction with `requireVisibleSectionInTx`, after taking the space row lock. Hiding never touches the sections' data, and `GET /api/v1/space` answers every member with the sections map their navigation follows. The same policy filters each section module's sync contributor. Hiding writes no per-row tombstones — the sections map travels on the space row inside the sync response, the client drops a hidden section's rows, and the client that sees a section shown again discards its cursor and syncs from revision 0 once ("Visibility changes" under Synchronisation).

The `media` module is the photos' engine (issue #17, ADR-0008): it owns the image rows and the storage objects — the original kept byte-for-byte, plus the metadata-free WebP derivatives its worker handler generates, HEIC through the image's libheif CLI. Its HTTP surface is none: a photo's permissions are its entry's, so the owning section module (the journal today) mounts the upload, removal, and serving routes and hands the media service the visibility checks as injected functions — the same port wiring the composition root already does for lower modules, and the dependency graph stays acyclic (media never imports upward). A photo has no sync entity or tombstone of its own: it travels inside its entry's DTO under the entry's visibility, and every photo change stamps the entry row through the `touchEntry` port the composition root wires to the journal — that stamp is what re-delivers the entry, photos included. The removal and the purge of a photo's objects ride their transaction as an idempotent queued job with retries of its own, so a storage hiccup costs retries, never leaked bytes. Uploads stream through the API — counted and hashed on the way, refused past the configured size limit, their bytes taken back when the transaction refuses — into object storage before the row's transaction runs.

The calendar's recurrence follows the same delivery shape (issue #21): the stored rule is an RFC 5545 RRULE narrowed to the DAILY, WEEKLY, MONTHLY, and YEARLY frequencies with an optional UNTIL — the member never sends RRULE text, the service composes it from the structured recurrence the contracts carry, and its strict parse refuses anything wider on the read path. A repeating event's occurrence exceptions are rows of the calendar module keyed by original occurrence date, and they have no sync entity of their own: they travel inside their event's DTO, and an exception's change stamps the event row, which is the delivery. A whole-series edit keeps the exceptions the edited series still honours and deletes the ones whose original date it no longer produces. The client expands the occurrences itself from the one row, so the calendar reads the same offline (ADR-0002, ADR-0006); the expansion exists on both sides — the API's serves the shared table of test cases today and #22's reminder scheduling tomorrow, and a verbatim copy of that table in a test on each side keeps the two answers identical.

### Dependency rules

- Routes call services. They never query the database, and they never contain domain rules.
- A service owns its module's tables. Other modules use its `index.ts` exports and never import another module's repository, tables, or internal files. Two exceptions: a module's `tables.ts` may import another module's `tables.ts` solely to declare the foreign keys of ADR-0016 (the composite keys between space-owned tables) and single references to installation-wide tables such as `administrators`; and test files with the test harness are not modules and may import internals directly. `index.ts` exports services and domain types, not repositories or table objects.
- Services receive dependencies (db, clock, storage, jobs, push, config) explicitly. There are no module-level singletons, and nothing reads `process.env` outside `platform/config`.
- `platform/` knows nothing about domain modules. Modules depend on platform, never the reverse.
- Dependency cycles between modules are not allowed. When two modules need each other, the shared rule moves into the lower one.
- Lint rules enforce these boundaries where Biome can express them. Review enforces the rest.

### Composition

`buildApp(deps)` assembles the Fastify instance from explicit dependencies and returns it without listening. The server entrypoint builds the real dependencies from config and calls it. Tests call it with a Testcontainers database, a RustFS container, a controllable clock, and a recording push sender. `buildWorker(deps)` does the same for pg-boss handlers.

When a lower module needs something only a higher module can compute — the spaces listing shows member counts, or the spaces module's member-facing routes mount the access module's session guard, for example — the lower module declares the dependency as a port (a function type in its own service or route options), and `buildApp` wires the port to the higher module's public surface. Modules never import upward, so the dependency graph stays acyclic.

### Request lifecycle

1. The `/api/v1` prefix is applied. The version changes only for breaking changes to published contracts.
2. Schema validation runs through Fastify's JSON Schema compilation of TypeBox schemas.
3. Authentication:
   - Member routes read the `X-Ohana-Member` header naming the intended member and require that member's session cookie.
   - Administrative routes require the administrative session cookie. State-changing administrative requests must also carry the `X-Ohana-Admin` marker header.
   - The resulting actor is attached to the request as `{ kind: 'member', memberId, spaceId, role, sessionId }` or `{ kind: 'admin' }`.
4. The section gate runs for routes that belong to a section.
5. The handler calls a service with the actor and validated input.
6. The response is serialised through its response schema, so unlisted fields never leave the server.

Member routes never take a space ID from the URL or body. The space always comes from the authenticated actor. Administrative routes name the space explicitly.

Every state-changing request carries the `X-Ohana-Member` header or an administrative marker header. Together with SameSite cookies and same-origin serving, this is the CSRF defence. Cross-origin requests are not allowed.

### Errors

Services throw typed domain errors. One error handler maps them to HTTP responses shaped `{ error: { code, message } }`, where `code` is a stable machine string such as `access_code_expired` and the client translates it. Resources the actor cannot see return 404, not 403, so their existence is not revealed.

### Data access

- **Space scoping:**
  - Every space-owned table has a non-null `space_id`, and space-owned tables reference each other with composite `(space_id, id)` foreign keys (ADR-0016).
  - Repositories for space-owned tables take `spaceId` as a required first argument.
  - There is no unscoped query helper for space-owned tables. Administrative queries across spaces live in clearly named administrative repositories.
  - **Single compare-and-set writes need no space row lock.** A use case whose only write to a space-owned row is one conditional `UPDATE … WHERE status = … RETURNING` (code redemption, revocation) serialises through that row's lock alone; the foreign-key `FOR KEY SHARE` checks it takes do not conflict with the `FOR NO KEY UPDATE` lock that issuance holds. Reads that decide a refusal may also stay lock-free while their follow-up write stays guarded by its own status condition.
  - **Credential lookups are the stated exception:** authenticating a session token or an access code can only look its row up by hash, before any space is known. The by-hash reads and writes on `access_codes` and `member_sessions` (`findAccessCodeByHashAcrossSpaces`, `redeemAccessCodeByHashAcrossSpaces`, `findMemberSessionByTokenHashAcrossSpaces`, `touchMemberSessionByTokenHashAcrossSpaces` — the throttled last-used stamp of an authentication —, `deleteMemberSessionByTokenHashAcrossSpaces`, `deleteExpiredMemberSessionsAcrossSpaces`) are therefore cross-space by design and say so in their names; everything else on those tables takes `spaceId`.
- **Installation-wide tables:** the instance administrator, administrative sessions, and the instance settings (`admin` module) are not space-owned; they are the one exception to the conventions above, with no `space_id`, no revision, and no tombstones.
- **Identifiers:** primary keys are UUIDv7 generated by the application, and timestamps are `timestamptz`.
- **Transactions:**
  - A use case that changes data runs in one transaction.
  - The transaction also bumps the space revision, stamps changed rows with it, writes tombstones, and enqueues jobs.
  - Nothing outside the transaction observes a half-done change.
- **Migrations:** migrations are generated by Drizzle Kit, reviewed, and never edited after they are merged.

### Synchronisation

The sync conventions below are established in the foundation and must not be bypassed (ADR-0014).

**Revision bookkeeping:**

- `spaces.revision` is a bigint counter.
- A changing transaction increments the counter once with `UPDATE … RETURNING` and stamps every row it writes with the new value.
- The row lock on the space serialises writers within a space. A client that has seen revision N therefore never misses a change committed at N or lower.
- A use case that must read before deciding to write takes the space row lock first (`lockSpace`) and only then reads its rows; row locks on space-owned rows come after it, never before. One lock order keeps the transactions deadlock-free. The space row lock, and any row lock on a space-owned row, takes `FOR NO KEY UPDATE`, not the stronger `FOR UPDATE`, so it never blocks the `FOR KEY SHARE` locks that foreign-key checks take in unrelated transactions.

**Tombstones:**

- Each synchronised table has a `revision` column.
- The single `sync_tombstones` table records `(space_id, revision, entity, entity_id, audience)`. The audience is either everyone, or a single member when something leaves only that member's view. An entity whose visibility excludes exactly one member — a gift reservation is visible to every member but the wish's author (ADR-0001) — leaves the view of a set of members: the transaction writes one member-scoped tombstone per member of the set and never an `all` tombstone, which would land on the excluded member's devices and tell them the entity existed; the member set is read under the same space row lock the deletion runs behind.

**Sync contributors:**

- Each module with synchronised data exports a sync contributor: a `changesSince(tx, actor, revision) → { upserts }` function, plus the wire schema of its change objects and the tombstone entities it answers for.
- The contributor applies the module's `policy.ts`. Ordinary reads apply the same policy, so what a member may see is defined in exactly one place per module.
- Tombstones live in the one shared table the sync module owns; the sync service reads them once per request for the contributors' entities, and `readTombstonesSince` applies the audience filter (everyone, or the one member something left) in exactly one place. Within one response an upsert of a row always outranks a tombstone of the same row — the contributor's rows are what exists now — so clients apply tombstones first and upserts second.
- The `spaces` module contributes the space row (name, time zone, `sections`) as an upsert whenever `spaces.revision` is newer than the cursor, so section visibility reaches offline clients (ADR-0011, ADR-0014).
- The sync module merges contributors and returns `{ revision, changes, tombstones }`; `GET /api/v1/sync?since=<revision>` answers it to the requesting member, the space always the actor's own. The response contract is composed from the wired contributors in the composition root, so a section module plugs in without editing the sync module.

**Visibility changes:** when something stops being visible to a member (an entry is trashed, a member is archived), the transaction writes tombstones for the affected audience. Hiding a section is the exception (ADR-0011, ADR-0014): the sections map travels on the space row inside the sync response, so a hide writes no per-row tombstones — the client drops a hidden section's rows when it applies the new map, and the client that sees a section go from hidden to visible discards its cursor and syncs from revision 0 once — except a re-show seen inside that resync response, which already carries every section whole — because a delta cannot carry rows older than its cursor; the reset is stored in the same local-store transaction that applies the new map (the cursor is written as 0 instead of the response's revision), so an interrupted resync restarts from 0.

### Background jobs

- pg-boss runs on the same PostgreSQL. Jobs are sent inside the domain transaction through pg-boss's transaction-aware submission, and every process that sends to a queue ensures the queue exists first.
- Handlers are safe to repeat, because they check current state before acting.
- Recurring maintenance jobs (trash purge, private-state purge) are scheduled with pg-boss's cron.
- Time comes only from the injected clock.
- pg-boss maintains its own queue schema (`pgboss`) at instance start — the one schema change that does not travel through the migrate entrypoint, because the library owns its migrations.

### Object storage

- `platform/storage` exposes a small port: put a stream, get a stream, delete, and head. Its S3 implementation uses the AWS SDK with a configurable endpoint.
- Object keys have the form `spaces/<spaceId>/<kind>/<id>/<variant>`.
- Clients never receive storage URLs. Downloads stream through authorised API routes.

### Push

`platform/push` exposes a `PushSender` port. The Web Push implementation uses VAPID keys persisted on first start, and tests use a recording implementation.

### Configuration and logging

- Configuration is read once from the environment, validated with a TypeBox schema, and passed as a typed object.
- Missing or invalid configuration stops startup with a clear message.
- The initial instance-administrator password arrives as configuration and is used only while no administrator exists (ADR-0005); after that it is ignored, so rotating it out of the deployment environment is safe. An installation started without one serves normally but rejects every administrative sign-in until the operator sets the password and restarts.
- Logs are structured Pino output. Access codes, session tokens, passwords, and cookies are redacted.

### Testing

Tests go through `buildApp` over HTTP and through `buildWorker`, against real PostgreSQL and RustFS containers that are started once per test run. The run's global setup passes the container endpoints to the test workers through environment variables that only `src/testing` reads, and applies migrations once per run to provision the throwaway database; outside tests, migrations run only through the migrate entrypoint. Each test file creates its own spaces and members with factory helpers, so tests never depend on each other or on shared data. Access rules are always tested with pairs of members, or pairs of spaces: one actor creates something, the other must not see it. Tests do not mock the database or assert on internals.

## Web client (`apps/web`)

### Layout

```
src/
  app/          router, providers, theme provider, and the assembled shells in app/layouts/ (member, admin, auth)
  routes/       TanStack Router file routes; /design previews the design system
  features/
    <feature>/  components, hooks, and queries for one area (journal, calendar, wishlist, sign-in, admin, …)
  data/         API client wiring, session registry, sync engine, IndexedDB store
  ui/           design-system components (shadcn/Base UI, restyled)
    styles/     design tokens and glass materials, exposed to Tailwind through @theme
  lib/          small framework-independent helpers
  testing/      test setup and shared test helpers
scripts/        one-off generators (the PWA icons, from the favicon)
e2e/            Playwright specs: the interface flows run against the dev server
                (test:e2e), the shell specs (*.pwa.spec.ts — manifest, service
                worker, offline routes, update offer) run against a production
                build through vite preview (test:e2e:pwa)
```

### Rules

- Components never call `fetch`. Server data comes through the generated API client (`packages/api-client`), wrapped in TanStack Query hooks inside `features/<feature>` or `data/`.
- Synchronised data is read from the local store. The sync engine calls the sync endpoint and applies the changes to IndexedDB in partitions keyed by member ID — one database per member, deleted whole when that member signs out. Screens read those partitions reactively, so the same code works online and offline; a device with nothing downloaded says so instead of showing empty sections. When the API is unreachable, a retained sign-in keeps working: the session probe assembles the member's identity from the session registry and the local store instead of declaring them signed out. A refusal (401) is the answer instead: the engine forgets the run, and the member leaves the device exactly as a sign-out removes them. The engine is started from one place per member area — the member session gate — and again after every successful mutation; a refused mutation triggers it too when the screen that issued it reads the refused row or map from the local store (the journal's mutations do), and a 401 on any mutation signs the member out through the engine's refusal path; runs asked for mid-flight queue rather than drop. The engine applies a re-shown section's map with the cursor written as 0 and runs the resync at once (ADR-0014) — except a re-show seen inside the resync response, which already carried every section whole; the same transaction records which sections await their replay, and a list screen whose section is recorded says nothing is downloaded until the replay lands, while a screen showing one entry shows a row it holds and gives that answer only for a row it lacks. A local-store upgrade that adds a synchronised store resets a stored cursor to 0 inside the upgrade transaction the same way, so a device that synced before the store existed replays the data it was never sent (only a cursor that exists is reset — an empty partition stays empty). An apply answers the request the engine sent at its cursor: a response for a cursor the store has moved past is stale, nothing of it lands, and the engine asks again from the stored cursor — up to twice; stale answers beyond that mean the two reads of the store disagree, and the honest answer is the error state. Online-only data (the administrative area, session lists, and the journal's trash view — a trashed entry has left every device's synchronised partition, so the view asks the server) uses ordinary queries.
- Mutations go to the API. A success triggers a sync, and so does a refusal under the condition above; neither patches the cache by hand.
- The session registry stores which members are signed in on this device (member ID, space name, display name), and never tokens. The active member is the default on every request as `X-Ohana-Member`; a request tied to one member — such as a query keyed by member — names that member explicitly, and the middleware never overrides it.
- Every user-visible string comes from `packages/i18n`. The one exception is the web app manifest, a single static document read before any code, written in the default language (Russian). API error codes map to translated messages.
- `ui/` holds only design-system components, and screens are composed from them. Feature code never overrides design tokens with one-off colours or sizes.
- The visual language is defined in `docs/design/README.md`. Each screen is built against its reference prototype in `docs/design/screens/`, which that document maps to tickets. The web client never imports from `docs/design/`.
- The service worker precaches the shell and caches image derivatives as they are viewed. It never caches API responses; data offline comes only from the local store. Registration happens once per page at the app entry (`lib/app-update.ts`), and the shells only place the update banner in the page flow; the web app manifest and the icons come from the build (`vite.config.ts`, `scripts/generate-icons.mjs`).

## Shared packages

- `packages/api-client`: generated from the committed `openapi.json`, and never edited by hand.
- `packages/i18n`: i18next catalogues with ICU plurals, shared by the web client and the worker.
- `packages/config`: shared TypeScript and Biome configuration.

There is no shared domain package between api and web. The contract is only the OpenAPI document (ADR-0013).

## Definition of done for every ticket

- Behaviour is covered by HTTP or worker tests at the seams above. Interface flows named in the ticket have Playwright tests.
- Lint, type check, tests, and the OpenAPI drift check pass in CI.
- New tables follow the space-scoped, revision, and tombstone conventions.
- New user-visible text exists in Russian and English.
- `CONTEXT.md`, the ADRs, or this document are updated when the change alters what they say.
