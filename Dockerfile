# One image, three entrypoints (server, worker, migrate) — see ADR-0009 and ADR-0018.

FROM node:24-alpine AS build
WORKDIR /repo
# Keep in sync with "packageManager" in package.json.
RUN npm install --global pnpm@11.20.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/i18n/package.json packages/i18n/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ohana/web build

# The api package has no workspace dependencies, so a legacy deploy yields a
# self-contained directory: source, migrations, and production node_modules.
RUN pnpm --filter @ohana/api deploy --prod --legacy /app

FROM node:24-alpine
ENV NODE_ENV=production
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
