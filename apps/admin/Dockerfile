# syntax=docker/dockerfile:1
#
# Built from the repo root so the pnpm workspace (lockfile + all packages) is
# in context: `docker build -f apps/admin/Dockerfile .`. `pnpm deploy` then
# prunes a self-contained bundle for just this app into /app. No database and
# no volume: the admin talks to the API over the internal network.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @attakk/admin build
RUN pnpm --filter @attakk/admin deploy --prod /app

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
