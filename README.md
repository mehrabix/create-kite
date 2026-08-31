# 🪁 create-kite

> Scaffold a Shopify Liquid theme workspace in seconds — with optional Tailwind CSS v4 and a full developer toolchain.

`create-kite` is an interactive CLI that generates a complete, production-ready
**Shopify Online Store 2.0 theme** based on the Shopify Skeleton theme, then wires
up the tools you pick: Tailwind, Prettier, theme-check, CI, git hooks and more.

No frameworks. No runtime dependencies for merchants. Just clean Liquid + the
tools you asked for.

---

## Quick start

```bash
npx create-kite my-theme
```

Follow the prompts, then:

```bash
cd my-theme
pnpm install
pnpm dev        # = shopify theme dev --store YOUR-STORE.myshopify.com
```

> Requires **Node.js ≥ 20** and the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) (`npm i -g @shopify/cli`).

### Non-interactive

```bash
# All defaults, zero prompts
npx create-kite my-theme --yes

# Full control via flags
npx create-kite my-theme --template minimal --pm pnpm --store my-store.myshopify.com \
  --no-tailwind --no-git --no-install
```

---

## What you get

A theme based on the **Shopify Skeleton theme** (`atlas-theme` base):

```
my-theme/
├── assets/            # critical.css + icon SVGs
├── blocks/            # group, text blocks
├── config/            # settings_schema.json, settings_data.json
├── layout/            # theme.liquid, password.liquid
├── locales/           # en.default.json + schema
├── sections/          # hello-world demo section
├── snippets/          # css-variables, image, meta-tags
├── templates/         # index.json, gift_card.liquid
├── .gitignore         # node_modules, .shopify, release
├── .shopifyignore     # dev tooling excluded from pushes
├── .theme-check.yml
├── .editorconfig
└── package.json       # dev, check, css:build scripts
```

### Tailwind CSS v4 (optional, on by default)

When enabled, create-kite adds:

- `tailwindcss` + `@tailwindcss/cli` dev dependencies
- `src/tailwind-input.css` — with **shadcn-style design tokens** mapped to the
  theme's CSS variables (`bg-primary`, `text-muted-foreground`, `border-border`…),
  so colors recolor live from the theme editor
- `assets/tailwind.css` — **built and committed** at scaffold time, so merchants
  never need a build step
- Scripts: `css:build` (minified build) and `css:watch` (rebuild on save)

Disable with `--no-tailwind` for a pure-Liquid theme.

### Toolchain options (all interactive, all optional)

| Prompt | Options | Default |
|--------|---------|---------|
| Template | minimal / full | minimal |
| Package manager | pnpm / npm / bun / yarn | auto-detect |
| Tailwind CSS v4 | yes / no | yes |
| JavaScript layer | none / alpine / vanilla-ts | none |
| Prettier + Liquid plugin | yes / no | yes |
| theme-check preset | recommended / strict | recommended |
| VS Code workspace config | yes / no | no |
| GitHub Actions CI | none / check / check+deploy | none |
| Git hooks (husky + lint-staged) | yes / no | no |
| Store URL | text / skip | skip |
| Git init + commit | yes / no | yes |
| Install dependencies | yes / no | yes |

### Generated scripts

| Script | Command |
|--------|---------|
| `pnpm dev` | `shopify theme dev` (+ `--store` if provided) |
| `pnpm check` | `shopify theme check` |
| `pnpm css:build` | Build Tailwind to `assets/tailwind.css` |
| `pnpm css:watch` | Rebuild Tailwind on save |
| `pnpm js:build` / `js:watch` | Bundle Alpine/TS with esbuild (if JS layer) |
| `pnpm format` | Prettier (if enabled) |
| `pnpm deploy` | `shopify theme push --unpublished --confirm` |
| `pnpm list` / `pull` / `push` / `open` | Shopify theme management wrappers |

---

## Flags

| Flag | Description |
|------|-------------|
| `--yes` | All defaults, no prompts |
| `--template <minimal\|full>` | Choose template |
| `--pm <pnpm\|npm\|bun\|yarn>` | Package manager |
| `--tailwind` / `--no-tailwind` | Tailwind CSS v4 |
| `--preflight` | Enable Tailwind preflight (default off) |
| `--js <none\|alpine\|vanilla-ts>` | JavaScript layer |
| `--prettier` / `--no-prettier` | Prettier + Liquid plugin |
| `--check <recommended\|strict>` | theme-check preset |
| `--vscode` / `--no-vscode` | VS Code workspace config |
| `--ci <none\|check\|check+deploy>` | GitHub Actions workflow |
| `--hooks` / `--no-hooks` | husky + lint-staged |
| `--store <url>` | Pre-fill store in dev script |
| `--git` / `--no-git` | Git init + commit |
| `--install` / `--no-install` | Install dependencies |
| `--json` | Machine-readable summary output |

---

## Requirements

- **Node.js ≥ 20**
- **Shopify CLI** for `dev`/`push`/`check` commands:
  ```bash
  npm install -g @shopify/cli
  ```
- A Shopify store (create a free development store with `shopify store create dev`)

---

## How it works

1. Parses flags (or runs the interactive wizard)
2. Copies the theme template (minimal = Skeleton base)
3. Writes configs per your choices (Tailwind, Prettier, CI, hooks…)
4. Installs dependencies with your package manager (verifies install succeeded)
5. Builds `assets/tailwind.css` if Tailwind is enabled
6. `git init` + initial commit
7. Prints next steps — including the exact `pnpm dev` command

The generated theme is **theme-check clean** and follows Shopify Online Store 2.0
best practices.

---

## Development

```bash
git clone https://github.com/mehrabix/create-kite
cd create-kite
pnpm install
node create.js my-test-theme --yes      # test locally
```

---

## License

MIT
