# `@pointer/web` — product site

The Pointer landing page: one bilingual page (Chinese and English, picked from the browser and
switchable in the header) whose text you can select to try the overlay. It deploys as its own
Cloudflare Worker, `pointer-web`, using [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)
(not Cloudflare Pages).

## The page

- Paper-and-ink look: serif article text, one blue from the app icon, light and dark follow the system. The overlay keeps the desktop's system font and surface, so it reads as a separate layer
- `src/demo/` is a small in-page copy of the overlay (bubble → action bar → result panel, the same sizes, springs and icons as `apps/desktop`). It is not the desktop `Overlay.tsx`, which is tied to Tauri. Change both when the overlay's look or motion changes
- Selecting text anywhere in `<main>` opens it. The sample passage has prepared answers in `src/demo/answers.ts`; any other text gets a note that this is a demo. Copy and Search really copy and search. Nothing calls a model
- Touch screens can't select into the overlay, so there the demo plays itself with a fake cursor; "watch it once" plays the same script on desktop
- `public/margin/` holds four open-licence pictures of glossed and annotated books (Wikimedia Commons, public domain, CC BY 2.0 and CC BY-SA 4.0). Their credits are in `PICTURES` in `src/App.tsx` and printed in the footer; keep the two in step
- Copy is in `src/i18n.ts`. Facts on the page (shortcut, permissions, presets, privacy rules, OS versions) come from `CONTEXT.md` and `apps/desktop`; update the page when those change

## Downloads

`src/downloads.ts` is the landing page's only download target. It points at the public repository
`https://github.com/recallhyx/pointer`, not at `recallhyx/pointer-app`:

- `https://github.com/recallhyx/pointer/releases`
- `https://github.com/recallhyx/pointer/releases/latest/download/Pointer-macos-universal.dmg`
- `https://github.com/recallhyx/pointer/releases/latest/download/Pointer-windows-x64-setup.exe`

There are no installers to download until a release is **published** on `recallhyx/pointer`.
`releases/latest` skips drafts and prereleases, and assets of a private repository are not
downloadable by visitors. Building a draft on `recallhyx/pointer-app` does not fill these links.

`package.yml` copies the Tauri output onto those two stable names and, for a `v*` tag, uploads
exactly those files to a draft release. Publishing that draft on `recallhyx/pointer` is what makes
the links work. The installers are unsigned for now, so the FAQ explains how to open them past
Gatekeeper and SmartScreen. Drop those answers once signing lands (`docs/packaging.md`).

## Stack

- `compatibility_date` is `2026-10-19`: the newest date workerd from Wrangler 4.151.0 will boot. Advance it when Wrangler is upgraded
- Vite + React builds `index.html`, `src/` and `public/` into `dist/`. The only web font is Newsreader (Latin, one variable file); Chinese uses the system serif, so no multi-megabyte CJK font is shipped
- `wrangler.jsonc` serves that directory. There is no Worker script, KV binding, or secret
- `/` is `index.html`. Any other path 404s (`assets.not_found_handling` is `none`)
- `nodejs_compat` is on so a future script can import Node built-ins. Add `main` and a `cf-typegen` script (`wrangler types`) when that script exists. Nothing to generate today

## Local

Node.js 22+ (Wrangler). From the repo root:

```bash
pnpm install
pnpm --filter @pointer/web dev
```

`dev` is Vite with HMR at http://127.0.0.1:1430. `pnpm web` from the root is the same command.

To serve the built assets the way `wrangler deploy` will:

```bash
pnpm --filter @pointer/web build
pnpm --filter @pointer/web preview
```

`preview` is `wrangler dev` and reads `dist/`. Default local URL is http://127.0.0.1:8787.

## Checks

```bash
pnpm --filter @pointer/web typecheck
pnpm --filter @pointer/web test
pnpm --filter @pointer/web build
```

## Deploy

Do not deploy until asked. No account resources or secrets are required.

```bash
pnpm --filter @pointer/web deploy
```

That builds, then runs `wrangler deploy` with the Wrangler account you are logged into. The URL will look like `https://pointer-web.<subdomain>.workers.dev`. Do not commit account ids, tokens, or custom domains here.
