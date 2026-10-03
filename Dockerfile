# One image, three entrypoints (server, worker, migrate) — see ADR-0009 and ADR-0018.

FROM node:24-alpine AS build
WORKDIR /repo
# pnpm's version comes from the "packageManager" field in package.json.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/i18n/package.json packages/i18n/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ohana/web build

# The legacy deploy yields a self-contained directory: source, migrations,
# and production node_modules. The api's one workspace dependency
# (@ohana/i18n, the reminders' payload texts) is deployed as the workspace
# link it keeps; the package travels as TS source, and node strips types
# only outside node_modules, so it lands in /app/vendor under a link from
# the deployed tree. Its own node_modules is dropped so its runtime
# dependencies (i18next, i18next-icu) resolve from /app/node_modules, where
# they are listed as the api's direct dependencies.
RUN pnpm --filter @ohana/api deploy --prod --legacy /app && \
    mkdir -p /app/vendor && \
    cp -R /repo/packages/i18n /app/vendor/i18n && \
    rm -rf /app/vendor/i18n/node_modules && \
    rm /app/node_modules/@ohana/i18n && \
    ln -s /app/vendor/i18n /app/node_modules/@ohana/i18n

FROM node:24-alpine
ENV NODE_ENV=production
# The worker decodes HEIC photos (issue #17, ADR-0008): sharp's prebuilt
# libvips carries no HEVC decoder, so the image provides libheif's
# `heif-dec`. The release smoke verifies the decode on amd64 and arm64
# before any image is published.
RUN apk add --no-cache libheif-tools
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --from=build --chown=node:node /repo/apps/web/dist /app/web
USER node
EXPOSE 3000
# Compose overrides this command to run the migrate and worker entrypoints.
CMD ["node", "src/entrypoints/server.ts"]

LABEL org.opencontainers.image.title="Ohana" \
  org.opencontainers.image.description="Ohana api, worker, and migrate entrypoints with the built web client" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
