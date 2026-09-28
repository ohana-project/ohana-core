# Organise the repository as a pnpm workspace

The repository is a pnpm workspace with a small, fixed layout:

- `apps/web`: the static React client ([ADR-0012](0012-static-react-spa-client.md)).
- `apps/api`: the Fastify backend, with `server`, `worker`, and `migrate` entrypoints in one image ([ADR-0009](0009-runtime-and-background-work.md)). Domain modules (spaces, members, access, journal, calendar, wishlist, sync, media) live under `src/modules/` and are not separate packages.
- `packages/api-client`: types and a fetch client generated from the committed `openapi.json` ([ADR-0013](0013-typebox-openapi-api-contract.md)). CI fails when the committed document differs from what the route schemas produce.
- `packages/i18n`: translation catalogues shared by the web client and the worker, using i18next with ICU plural rules.
- `packages/config`: shared TypeScript and lint configuration.
- `deploy/`: the Compose file, Caddyfile, and environment example.

For local development, `deploy/compose.dev.yaml` runs only PostgreSQL and RustFS; the web client and API run on the host with `pnpm dev` for fast reloads, and the Vite dev server proxies `/api` to the API to keep the production same-origin shape. A single `pnpm setup` installs dependencies, starts those services, and applies migrations.

Tests use Vitest. API tests run against a real PostgreSQL through Testcontainers rather than a mocked database, because the access rules that matter most (another member's drafts stay hidden, a wish's author never sees its reservations, spaces never mix) are only meaningful against real queries. Playwright covers a few end-to-end flows, such as access-code sign-in and offline reading, once the interface exists.

Biome handles linting and formatting in one tool. A build orchestrator such as Turborepo is deferred until workspace builds become slow; with two applications, pnpm's recursive scripts are enough and keep the setup approachable for new contributors.
