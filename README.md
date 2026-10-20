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

Each block gets `ctx.load()` / `ctx.save()` for its own private storage, and `ctx.every(ms, fn)` for refreshing. Arrange the dashboard via **Menu → Edit layout**: drag a block by its title bar, drag a bottom corner to resize, or hide it. Positions are saved to your account (the grid is [GridStack](https://gridstackjs.com), MIT, vendored in `public/assets/vendor/`). Phones show one column in the same order.

Blocks that need outside data (calendar, email, weather…) should fetch it through a small Cloudflare Function in `functions/api/` so API keys stay on the server — anything under `/api/` (except sign-in) is automatically locked to signed-in users.

## Trading (signal-copier bot)

`/dashboard/trading/` is a full trading dashboard, and the **Trading** block on the main dashboard shows the
headline numbers. The data comes from the signal-copier bot on Railway through `functions/api/trading.js`, so the
bot's password stays on Cloudflare. Settings → Variables and secrets:

- `COPIER_URL` — the bot's Railway address, e.g. `https://signal-copier-production.up.railway.app`
- `COPIER_PASSWORD` — type **Secret** — the same value as `DASHBOARD_PASSWORD` on Railway

New dashboards can follow the same pattern: a page in `public/dashboard/<name>/`, a function in
`functions/api/<name>.js` for its data, and an optional summary block. `assets/theme.js` adds the ☀️/🌙 switch
to any page that loads it and has a `.theme-btn` button.

## Calendar block

"Upcoming" shows the next 14 days from any number of calendars. On the dashboard tap **Calendars** under the block and paste each calendar's private iCal link (the block explains where to find them for Apple, Google and Outlook). Links are stored server-side only; feeds are re-fetched at most every 10 minutes.

## Budget tracker

`/dashboard/budget/` (plus a **Budget** block) shows money in, spending by category against monthly budgets, and every transaction. Data comes read-only from your banks through [Enable Banking](https://enablebanking.com) (Open Banking):

1. enablebanking.com → sign in → **API applications → Add a new application**, environment **Production**, redirect URL `https://nealchauhan.co.uk/bank-callback`. Save the downloaded `.pem` file.
2. On the new app press **Activate by linking accounts** and link one of your accounts (this puts it in "restricted" mode — your own accounts only, meant for personal non-commercial use).
3. Cloudflare → the Pages project → Settings → Variables and secrets: `EB_APP_ID` (the app ID) and `EB_PRIVATE_KEY` (**Secret**, paste the whole .pem file). Redeploy.
4. On the Budget page, search for each bank and press **Connect**.

Banks ask you to re-approve access every 90–180 days; the block warns a week before. Transactions sync when you open the page (at most every 6 hours, as banks limit how often apps can read). Transfers between your own accounts and card repayments are spotted and left out of the totals. Tap any transaction's category to change it — "always" remembers it for that shop.

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
