# Ohana

Ohana is a self-hosted place where a couple or family keeps its shared memory and plans: one space with a journal, a calendar, and wishlists, readable together even on poor connections, in Russian or English. It is designed for small home servers — one command installs it from prebuilt images.

The project is under active development toward version 1.0; see the [roadmap](ROADMAP.md) for direction and [GitHub Issues](https://github.com/ohana-project/ohana-core/issues) for the current state.

## Installing

You need a Linux machine on `amd64` or `arm64` (a Raspberry Pi 5 works) with [Docker](https://docs.docker.com/engine/install/) and the Compose plugin. Installing builds nothing: releases carry prebuilt multi-architecture images.

1. Download `compose.yaml` and `env.production.example` from the [latest release](https://github.com/ohana-project/ohana-core/releases/latest) into one directory, and rename the latter to `.env`.
2. Fill in the required values in `.env`. Every setting is documented in the file itself.
3. Start the stack:

   ```sh
   docker compose up -d                   # the api is published on $OHANA_PORT
   docker compose --profile caddy up -d   # or: Caddy terminates HTTPS in front of it
   ```

The release's Compose file already pins every image to tested versions — Ohana to this release, and PostgreSQL, RustFS, and Caddy to compatible versions — so an installation never pulls `latest` and never changes underneath itself.

When the stack is up, the whole application is served from one port: the web client at `/` and the api under `/api/`. Check `http://localhost:3000/api/health` (or your configured port) to confirm it is running.

## Upgrading

1. Download the new release's `compose.yaml` into the deployment directory, replacing the old one, and re-check your `.env` against the release's `env.production.example`.
2. Restart the stack:

   ```sh
   docker compose up -d
   ```

Compose pulls the new version's image and restarts what changed. Database migrations apply automatically: the `migrate` service runs before the api and worker start, so an upgrade is just pulling the new release and restarting it. If a migration fails, the api and worker stay stopped and the migrate service's log (`docker compose logs migrate`) shows what went wrong.

Your data lives in the named volumes `postgres-data` and `rustfs-data`, which upgrades leave untouched.

## Configuration

[`deploy/env.production.example`](deploy/env.production.example) documents every setting. The notable ones:

- **HTTPS.** With the `caddy` profile enabled, `CADDY_ADDRESS` picks what Caddy serves: a domain for automatic Let's Encrypt HTTPS, `localhost` for a locally issued certificate, or `http://<host>` for plain HTTP behind another proxy. Set `OHANA_PORT` to `127.0.0.1:3000` so the api is only reachable through Caddy.
- **Existing reverse proxy.** Leave the `caddy` profile off and point your proxy at the published api port.
- **External object storage.** Set `STORAGE_ENDPOINT` (with its region, keys, and bucket) to any S3-compatible endpoint instead of the bundled single-node RustFS.

## Development

You need Node 24 (with Corepack, for pnpm) and Docker.

```sh
pnpm setup   # install dependencies, start PostgreSQL and RustFS, apply migrations
pnpm dev     # run the api and the web client with reload
pnpm test    # test suites against real containers
```

[docs/architecture.md](docs/architecture.md) describes how the code is organised, [CONTEXT.md](CONTEXT.md) defines the domain language, and [docs/adr/](docs/adr/) records the decisions behind the design.

## License

[AGPL-3.0-only](LICENSE)
