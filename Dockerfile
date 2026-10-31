# Backend image: Redis + poller + engine + API in one machine, kept alive by scripts/supervise.mjs.
# Each service is bundled by esbuild into a single file, so the runtime image carries no node_modules.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY packages ./packages
COPY apps/poller ./apps/poller
COPY apps/engine ./apps/engine
COPY apps/server ./apps/server
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile --filter "./packages/**" --filter poller --filter engine --filter server --filter strata
RUN for a in poller engine server; do (cd apps/$a && node ../../scripts/bundle.mjs $a); done

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends redis-server ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/apps/poller/dist ./apps/poller/dist
COPY --from=build /app/apps/engine/dist ./apps/engine/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY scripts/supervise.mjs ./scripts/
ENV NODE_ENV=production NODE_OPTIONS=--no-deprecation PORT=8000
EXPOSE 8000
CMD ["node", "scripts/supervise.mjs"]
