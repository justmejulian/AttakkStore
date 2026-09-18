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
