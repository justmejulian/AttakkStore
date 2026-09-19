# attakk store

The [atk-collective.ch](https://atk-collective.ch) storefront, rebuilt as three
independently deployed apps in one pnpm monorepo.

| Path             | App   | Stack                                  | Owns                                   |
| ---------------- | ----- | -------------------------------------- | -------------------------------------- |
| `apps/shop`      | Shop  | Astro 7 + Lumos, node adapter          | Storefront pages, cart, checkout form  |
| `apps/api`       | API   | Node + Hono + better-sqlite3 _(later)_ | The database, QR bills, email, uploads |
| `apps/admin`     | Admin | Node + Hono, server-rendered _(later)_ | Order and product screens              |
| `packages/types` | Types | TypeScript + zod                       | Shared types and validation schemas    |

`apps/api` and `apps/admin` are scaffolded in a later milestone. `apps/shop` is
seeded from a fresh [Lumos](https://lumosframework.com/docs/) scaffold (Astro 7,
the Lumos component library copied in and owned outright); the attakk design and
API wiring land in the storefront milestone.

## Getting started

The toolchain is pinned. Node comes from `.nvmrc` (Node 24 LTS) and pnpm comes
through Corepack — no global install:

```sh
nvm use            # or: mise install
corepack enable    # activates pnpm@10 from packageManager
pnpm install
```

## Common tasks

```sh
pnpm dev           # run the shop dev server
pnpm build         # build every app in the workspace
pnpm check         # type-check every app that defines a check script
```

Each app can also be run on its own with `pnpm --filter @attakk/shop <script>`.

## Running the full stack locally

`docker-compose.yml` brings up all three apps plus the shared data volume on one
internal network, mirroring the Dokku topology so the stack can be verified
locally before anything is pushed. The API publishes no port (reachable only
over the `attakk` network); the admin binds to loopback; the shop is public.

```sh
docker compose up --build -d       # build all three, start the stack
curl localhost:4321                # shop (public)
curl localhost:8080/health         # admin (loopback only)
docker compose down -v             # stop and wipe the data volume
```

### macOS toolchain

There is no Docker Desktop dependency — [Colima](https://github.com/abiosoft/colima)
provides the Linux VM and Docker daemon:

```sh
brew install colima docker docker-buildx docker-compose
colima start                       # Linux VM + Docker daemon
```

The Dockerfiles use `RUN --mount=type=cache`, a **BuildKit** feature. Colima's
engine enables BuildKit by default, but the build has to go through the `buildx`
plugin — so link `buildx` (and `compose`, for the `docker compose` subcommand)
into Docker's plugin directory once:

```sh
mkdir -p ~/.docker/cli-plugins
ln -sfn "$(brew --prefix)/opt/docker-buildx/bin/docker-buildx" ~/.docker/cli-plugins/docker-buildx
ln -sfn "$(brew --prefix)/bin/docker-compose" ~/.docker/cli-plugins/docker-compose
```

Without `buildx`, Docker falls back to the classic builder, which does not
understand `--mount` and the build fails.

## Deploying with Dokku

Dokku never uses `docker-compose.yml` — it builds each app from its own
Dockerfile. Dokku apps are isolated by default, so reproducing the compose
topology takes an explicit shared network and `API_URL` config; without them the
admin and shop fall back to `http://localhost:3000` and never reach the API.

```sh
# Shared resources: one network the three apps resolve each other over, and the
# data directory the API owns — created before it is mounted, since Dokku will
# not create the host path for you.
dokku network:create attakk
dokku storage:ensure-directory attakk

# API — internal only, the sole writer of the data volume.
dokku apps:create attakk-api
dokku builder-dockerfile:set attakk-api dockerfile-path apps/api/Dockerfile
dokku network:set attakk-api attach-post-create attakk
dokku proxy:disable attakk-api                 # no published port
dokku storage:mount attakk-api /var/lib/dokku/data/storage/attakk:/data

# Admin — off the public proxy (reached through an SSH tunnel), talking to the
# API over the shared network.
dokku apps:create attakk-admin
dokku builder-dockerfile:set attakk-admin dockerfile-path apps/admin/Dockerfile
dokku network:set attakk-admin attach-post-create attakk
dokku proxy:disable attakk-admin
dokku config:set attakk-admin API_URL=http://attakk-api.web:3000

# Shop — the only public app. Reaches the API over the shared network and reads
# uploads straight off the API's volume, mounted read-only.
dokku apps:create attakk-shop
dokku builder-dockerfile:set attakk-shop dockerfile-path apps/shop/Dockerfile
dokku network:set attakk-shop attach-post-create attakk
dokku config:set attakk-shop API_URL=http://attakk-api.web:3000
dokku storage:mount attakk-shop /var/lib/dokku/data/storage/attakk/uploads:/uploads:ro
```

The Dockerfiles rely on BuildKit (the `RUN --mount` cache). Docker Engine 24+
uses BuildKit by default; on older engines enable it once on the host:

```sh
echo "export DOCKER_BUILDKIT=1" | sudo tee -a /etc/default/dokku
```
