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
  platform/       config, db, storage, jobs, push, clock, logging, errors, http plugins
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

Modules: `spaces`, `members`, `access`, `admin`, `journal`, `calendar`, `wishlist`, `sync`, `media`, `notifications`. A module is added only for a new domain area, never for a technical concern. The `admin` module owns the instance administrator: bootstrap from deployment configuration, administrative sessions, and the administrative password. Its `index.ts` also publishes the administrative guards and the marker-header contract schema, because member-facing modules mount the same protection for their own administrative routes.

### Dependency rules

- Routes call services. They never query the database, and they never contain domain rules.
- A service owns its module's tables. Other modules use its `index.ts` exports and never import another module's repository, tables, or internal files. The one exception: a module's `tables.ts` may import another module's `tables.ts` solely to declare the composite foreign keys that ADR-0016 requires. `index.ts` exports services and domain types, not repositories or table objects; test files and the test harness are not modules and may import internals directly.
- Services receive dependencies (db, clock, storage, jobs, push, config) explicitly. There are no module-level singletons, and nothing reads `process.env` outside `platform/config`.
- `platform/` knows nothing about domain modules. Modules depend on platform, never the reverse.
- Dependency cycles between modules are not allowed. When two modules need each other, the shared rule moves into the lower one.
- Lint rules enforce these boundaries where Biome can express them. Review enforces the rest.

### Composition

`buildApp(deps)` assembles the Fastify instance from explicit dependencies and returns it without listening. The server entrypoint builds the real dependencies from config and calls it. Tests call it with a Testcontainers database, a RustFS container, a controllable clock, and a recording push sender. `buildWorker(deps)` does the same for pg-boss handlers.

When a lower module needs something only a higher module can compute — the spaces listing shows member counts, for example — the lower module declares the dependency as a port (a function type in its own service), and `buildApp` wires the port to the higher module's public surface. Modules never import upward, so the dependency graph stays acyclic.

### Request lifecycle

1. The `/api/v1` prefix is applied. The version changes only for breaking changes to published contracts.
2. Schema validation runs through Fastify's JSON Schema compilation of TypeBox schemas.
3. Authentication:
   - Member routes read the `X-Ohana-Member` header naming the intended member and require that member's session cookie.
   - Administrative routes require the administrative session cookie. State-changing administrative requests must also carry the `X-Ohana-Admin` marker header.
   - The resulting actor is attached to the request as `{ kind: 'member', memberId, spaceId, role }` or `{ kind: 'admin' }`.
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
- **Installation-wide tables:** the instance administrator and administrative sessions (`admin` module) are not space-owned; they are the one exception to the conventions above, with no `space_id`, no revision, and no tombstones.
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
- The single `sync_tombstones` table records `(space_id, revision, entity, entity_id, audience)`. The audience is either everyone, or a single member when something leaves only that member's view.

**Sync contributors:**

- Each module with synchronised data exports a sync contributor: `changesSince(tx, actor, revision) → { upserts, tombstones }`.
- The contributor applies the module's `policy.ts`. Ordinary reads apply the same policy, so what a member may see is defined in exactly one place per module.
- The sync module merges contributors and returns `{ revision, changes }`.

**Visibility changes:** when something stops being visible to a member (a section is hidden, an entry is trashed, a member is archived), the transaction writes tombstones for the affected audience. When a section is shown again, the next sync sends its full data.

### Background jobs

- pg-boss runs on the same PostgreSQL. Jobs are sent inside the domain transaction through pg-boss's transaction-aware submission.
- Handlers are safe to repeat, because they check current state before acting.
- Recurring maintenance jobs (trash purge, private-state purge) are scheduled with pg-boss's cron.
- Time comes only from the injected clock.

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
e2e/            Playwright specs (pnpm --filter @ohana/web test:e2e)
```

### Rules

- Components never call `fetch`. Server data comes through the generated API client (`packages/api-client`), wrapped in TanStack Query hooks inside `features/<feature>` or `data/`.
- Synchronised data is read from the local store. The sync engine calls the sync endpoint and applies the changes to IndexedDB in partitions keyed by member ID. Screens read those partitions reactively, so the same code works online and offline. Online-only data (the administrative area, session lists) uses ordinary queries.
- Mutations go to the API. On success they trigger a sync; they do not patch the cache by hand.
- The session registry stores which members are signed in on this device (member ID, space name, display name), and never tokens. The active member is set on every request as `X-Ohana-Member`.
- Every user-visible string comes from `packages/i18n`. API error codes map to translated messages.
- `ui/` holds only design-system components, and screens are composed from them. Feature code never overrides design tokens with one-off colours or sizes.
- The visual language is defined in `docs/design/README.md`. Each screen is built against its reference prototype in `docs/design/screens/`, which that document maps to tickets. The web client never imports from `docs/design/`.
- The service worker precaches the shell and caches image derivatives as they are viewed. It never caches API responses; data offline comes only from the local store.

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
