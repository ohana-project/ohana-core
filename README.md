# Ohana

Ohana is a self-hosted place where a couple or family keeps its shared memory and plans: one space with a journal, a calendar, and wishlists, readable together even on poor connections, in Russian or English. It is designed for small home servers — one command installs it from prebuilt images.

The project is under active development toward version 1.0; see the [roadmap](ROADMAP.md) for direction and [GitHub Issues](https://github.com/ohana-project/ohana-core/issues) for the current state.

## Installing

You need a Linux machine on `amd64` or `arm64` (a Raspberry Pi 5 works) with [Docker](https://docs.docker.com/engine/install/) and the Compose plugin. Installing builds nothing: releases carry prebuilt multi-architecture images.

One command installs Ohana: the release's install script downloads the release's `compose.yaml`, generates the secrets into `.env`, starts the stack, and prints the address and the generated administrator password.

```sh
curl -fsSL https://github.com/ohana-project/ohana-core/releases/latest/download/install.sh | sh
```

By default the api answers plain HTTP on port 3000 of the machine itself and no reverse proxy is involved. Note that signing in sets Secure cookies: browsers keep them off plain HTTP, so reach Ohana through an SSH tunnel (some browsers refuse sign-in even on localhost over plain HTTP) or use one of the two HTTPS modes below. The other modes:

- `--caddy-domain ohana.example.com` serves `https://ohana.example.com` with automatic Let's Encrypt HTTPS through the bundled Caddy (point the domain's DNS at the machine first).
- `--external-network <network>` attaches the api to an existing Docker network so a reverse proxy in another Compose project — your own Caddy, Traefik, nginx — can reach it. The script writes a `compose.override.yaml` (the release's `compose.yaml` is never edited), binds the api port to `127.0.0.1` only, and prints the site to add to your proxy: with Caddy, one `reverse_proxy ohana:3000` line in your Caddyfile.

Run on a terminal the script asks which mode to use; piped or redirected it takes the default. The script is short — read it before running it (`curl -fsSL <the url> -o install.sh`, then `sh install.sh`) if you prefer not to pipe it. Reinstalling over an existing directory needs `--force`: it keeps the previous secrets (the data volumes are keyed by them) and the Compose project name, and leaves the previous `.env` as a `.env.bak` copy (`.env.bak.<timestamp>` when one already exists) — it is not the upgrade path; see [Upgrading](#upgrading) below. An installation whose `.env` was deleted refuses to reinstall until its `POSTGRES_PASSWORD` (and storage keys) are restored or its data is erased, so the data cannot be locked away by accident. A renamed directory can be reattached to its data by running the installer with `--force` and `COMPOSE_PROJECT_NAME=<the old Compose project name — `docker volume ls` shows it as the prefix of `_postgres-data`>, or by adding that line to `.env` by hand.

Or set it up by hand:

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
- **Existing reverse proxy.** Leave the `caddy` profile off and attach the api to your proxy's Docker network with a `compose.override.yaml` beside `compose.yaml` — Compose merges it automatically:

  ```yaml
  services:
    api:
      networks:
        default: null
        <your proxy network>:
          aliases: [ohana]

  networks:
    <your proxy network>:
      external: true
  ```

  Join the proxy's container to the same network, point it at `ohana:3000` (`reverse_proxy ohana:3000` in a Caddyfile), and set `OHANA_PORT` to `127.0.0.1:3000` so the published port stays a loopback-only convenience. `install.sh --external-network <network>` does all of this and prints the site. Two caveats: the api resolves DNS across every network it joins, so on a shared network whose other projects expose containers named `api`, `postgres`, or `rustfs`, name lookups inside Ohana can cross over — and Ohana's api itself answers to the name `api` there (Compose registers the service name), so another project's lookup of its own `api` can reach Ohana. A second Ohana on the same network would also claim `ohana`; give one network one Ohana.
- **External object storage.** Set `STORAGE_ENDPOINT` (with its region, keys, and bucket) to any S3-compatible endpoint instead of the bundled single-node RustFS.

## Releasing

Pushing a semantic version tag such as `v1.2.0` (prereleases like `v1.2.0-rc.1` are marked as such; `+build` metadata is not supported) publishes a release: the workflow runs the quality gate, builds the image natively for amd64 and arm64, verifies on both architectures that the pulled images start — with Caddy enabled, disabled, and installed through the release's own install script in its default and external-proxy-network modes — and only then tags the multi-architecture image and creates the GitHub Release with generated notes (a Quick start block with that release's install one-liners on top) and three assets attached: a Compose file pinned to the release version, the environment example, and the install script with the version baked in. Nothing else publishes: ordinary pushes run CI only.

One-time, at the first release: the `ghcr.io/ohana-project/ohana-core` package is created private by the first push; make it public in its package settings (Danger Zone → Change visibility) so operators can pull without credentials. The release smoke pulls anonymously, so it fails until this is done.

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
