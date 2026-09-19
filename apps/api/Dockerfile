# syntax=docker/dockerfile:1
#
# Built from the repo root so the pnpm workspace (lockfile + all packages) is
# in context: `docker build -f apps/api/Dockerfile .`. `pnpm deploy` then prunes
# a self-contained bundle for just this app into /app.

FROM node:24-slim AS base
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Toolchain for better-sqlite3 when no prebuilt binary matches the image arch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @attakk/api build
RUN pnpm --filter @attakk/api deploy --prod /app

FROM base AS runtime
ENV NODE_ENV=production
# The SQLite file and uploads must live on the mounted volume, not the
# ephemeral container filesystem. Both compose and Dokku mount it at /data, so
# default to that here — otherwise a deploy without DATA_DIR set writes to
# /app/data and loses every order on the next rebuild. Dev runs outside the
# image and keeps the ./data default.
ENV DATA_DIR=/data
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["node", "dist/index.js"]
