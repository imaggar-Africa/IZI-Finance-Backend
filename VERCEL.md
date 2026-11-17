# Deploy IZI Finance Backend on Vercel

Firebase setup is unchanged (`firebase.json`, `functions/index.js`, `npm run deploy`).

Root `vercel.json` uses a **single** `services.izi-backend` entry (required by Vercel’s Services import UI). Do **not** use “Import single project” on `functions/` or `app/` in the dashboard—deploy from the repo root only.

## Quick start

1. Install dependencies: `npm install`
2. Link the project: `npx vercel link`
3. Copy environment variables from your Firebase secrets / local `.env` into the Vercel project (**Settings → Environment Variables**). Use the same names as in `functions/index.js` / `.env` (e.g. `MONGO_URI`, `JWT_ACCESS_SECRET`, `MPESA_*`, `CLIENT_EMAIL`, `FB_PRIVATE_KEY`, `PROJECT_ID`, `STORAGE_BUCKET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, Africa's Talking vars).
4. For scheduled jobs on Vercel, use **Upstash QStash** — see [QSTASH.md](QSTASH.md) (`QSTASH_*` signing keys, `CRON_BASE_URL`, optional `CRON_SECRET`).
5. Deploy: `npm run vercel:deploy` or push to a Git branch connected in the Vercel dashboard.

Local Vercel dev (uses root `.env`):

```bash
npm run vercel:dev
```

## Endpoints

- All HTTP routes go through the same Express app as Firebase (`functions/app.js`).
- Health: `/healthz`, `/ping`, `/version`

Update M-Pesa callback URLs to your Vercel domain after the first deploy.

## Crons vs Firebase

On **Vercel**, schedules are **QStash only** → `api/cron/[job].js`. See [QSTASH.md](QSTASH.md).

Firebase `onSchedule` for the same five jobs is **disabled** by default (`ENABLE_FIREBASE_SCHEDULED_CRONS` not set). Run `firebase deploy --only functions` after this change to remove old Cloud Scheduler triggers.

## Limitations on Vercel

- **SMS**: Post-cron drain runs only on jobs listed in `CRON_SMS_DRAIN_ON` (default `reconciliation`) so five parallel crons do not each hit Africa’s Talking 25×. `CRON_SMS_DRAIN=false` disables. Tunes: `CRON_SMS_DRAIN_LIMIT` (default 25), `CRON_SMS_DRAIN_MAX_MS` (default 50000). Provider errors return in `smsDrain.errors` with `code`, `statusCode`, `providerStatus`. **`INSUFFICIENT_BALANCE` / statusCode 405** = top up Africa’s Talking SMS wallet. Long-lived **BullMQ worker** still runs on Firebase `api`.
- **Puppeteer / PDF** may need extra setup (e.g. `@sparticuz/chromium`) for serverless; test report/PDF routes after deploy.
- **Hobby plan**: `memory` is capped at **2048 MB** and `maxDuration` at **60s** in `vercel.json`. Upgrade to Pro for more memory/time; use Firebase for long PDF/cron jobs if needed.

## Firebase (unchanged)

```bash
npm run serve    # emulators
npm run deploy   # Firebase functions (+ hosting if configured)
```
