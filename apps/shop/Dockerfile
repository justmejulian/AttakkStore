# syntax=docker/dockerfile:1
#
# Built from the repo root so the pnpm workspace (lockfile + all packages) is
# in context: `docker build -f apps/shop/Dockerfile .`. `pnpm deploy` then
# prunes a self-contained bundle for just this app into /app. The @astrojs/node
# standalone adapter emits its own server at dist/server/entry.mjs.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @attakk/shop build
RUN pnpm --filter @attakk/shop deploy --prod /app

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
