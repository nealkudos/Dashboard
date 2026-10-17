# Neal's Dashboard

A private dashboard for your own domain, on Cloudflare Pages (free, no card-billing surprises).

- **Homepage (`/`)** is the sign-in page: password, then a 6-digit code from an authenticator app.
- **Every 30 days** you're made to set a new password **and** scan a fresh authenticator QR code. Old password, old authenticator entry and old recovery codes all stop working, and every other device is signed out.
- **8 single-use recovery codes** in case you lose your phone.
- **`/dashboard/`** is a grid of blocks. Nothing under it — including the block code — is served to anyone not signed in.
- Wrong attempts lock out for 15 minutes after 8 tries. Sessions last 12 hours.

## Deploy (about 10 minutes, all in the Cloudflare dashboard)

1. **Put this folder on GitHub** (a private repo, e.g. `nealkudos/dashboard`).
2. **Create the storage:** Cloudflare → *Storage & Databases → KV* → *Create namespace* → name it `dashboard`.
3. **Create the site:** *Workers & Pages → Create → Pages → Connect to Git* → pick the repo. This is a brand-new, standalone Pages project — don't add it to any existing project.
   - Build command: *(leave empty)*  · Build output directory: `public`
4. **Settings → Bindings → Add → KV namespace:** variable name `DASH_KV`, namespace `dashboard`.
5. **Settings → Variables and secrets:**
   - `SETUP_TOKEN` — type **Secret** — any long random string. You only need it once, for first setup.
   - `ROTATE_DAYS` = `30`
   - `ROTATE_MFA` = `true` (set `false` if you only want the password to rotate)
6. **Redeploy** (Deployments → ⋯ → Retry) so the bindings take effect.
7. **Custom domain:** *Custom domains → Set up* → e.g. `dash.yourdomain.co.uk`. Cloudflare handles HTTPS.
8. Open the site, enter the setup token, email and password, scan the QR code, save the recovery codes. Done.

To use it like an app on iPhone: open it in Safari → Share → *Add to Home Screen*.

(Settings live in the Cloudflare dashboard, so there's deliberately no `wrangler.toml` — a copy is in `wrangler.example.toml` if you ever want to deploy from the terminal instead.)

## Adding a block

1. Copy `public/dashboard/blocks/_template.js` → e.g. `calendar.js`. Change `id`, `title`, `size`, and what `render()` draws.
2. Open `public/dashboard/blocks/registry.js`, import it and add it to the list.
3. Push to GitHub — Cloudflare redeploys automatically.

Each block gets `ctx.load()` / `ctx.save()` for its own private storage, and `ctx.every(ms, fn)` for refreshing. Rearrange, resize (S/M/L) or hide blocks on the live site via **Menu → Edit layout**.

Blocks that need outside data (calendar, email, weather…) should fetch it through a small Cloudflare Function in `functions/api/` so API keys stay on the server — anything under `/api/` (except sign-in) is automatically locked to signed-in users.

## Files

```
functions/_middleware.js        guards /dashboard and /api, security headers
functions/_lib/crypto.js        password hashing, authenticator codes, recovery codes
functions/_lib/core.js          sessions, storage, lockouts, 30-day rule
functions/api/auth/[action].js  setup · login · verify · rotate · logout
functions/api/prefs.js          saved layout
functions/api/blocks/[id].js    per-block storage
public/index.html               homepage / sign-in
public/dashboard/               the dashboard and its blocks
```

## Locked out?

Use a recovery code. If those are gone too: Cloudflare → KV → `dashboard` → delete the `user` key, then run setup again with the setup token (your blocks' data is kept).

## Run locally

`npm install`, create a `.dev.vars` file containing `SETUP_TOKEN="anything"`, then `npm run dev` → http://localhost:8788.
