# @attakk/shop

The attakk storefront — Astro 7 on [Lumos](https://lumosframework.com/docs/),
the shop app of the [attakk-store](../../README.md) monorepo.

This app is seeded from a Lumos scaffold; the Lumos component library is copied
in and owned here rather than installed. See [`LUMOS.md`](./LUMOS.md) and
[`AGENTS.md`](./AGENTS.md) for the conventions that keep the site consistent,
and `.claude/skills/` for the Lumos task procedures.

## Development

Install and run from the repo root — the toolchain (Node, pnpm, lint, format)
is pinned and shared there; see the [root README](../../README.md).

```sh
pnpm install                     # from the repo root
pnpm --filter @attakk/shop dev   # or `pnpm dev`
```

Vite DevTools with the Oxc integration is wired up dev-only and loads only under
`astro dev`.

## Scripts

```sh
pnpm --filter @attakk/shop check     # astro check (type + template diagnostics)
pnpm --filter @attakk/shop build     # production build
pnpm --filter @attakk/shop preview   # preview the build
```

Lint and format are run for the whole workspace from the root: `pnpm code`.
