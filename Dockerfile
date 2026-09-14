# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: none of these deps' install scripts are needed here (the build stage compiles
# with tsc, not esbuild/tsx), and it sidesteps pnpm's build-script approval gate, whose approved
# state lives outside the repo (host-machine-local) and isn't available in a clean Docker build.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts/migrate.ts ./scripts/migrate.ts
RUN pnpm build

FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
# Raw migration SQL/meta files — read at runtime by dist/scripts/migrate.js, untouched by tsc.
COPY --from=build --chown=node:node /app/src/infra/db/migrations ./src/infra/db/migrations
COPY --chown=node:node package.json ./
COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x ./docker-entrypoint.sh

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
