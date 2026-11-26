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
- **Clear stale SMS** (live Mongo `sms_queue`, **no token** — anyone with the URL can delete stale rows):
  - Delete: `https://vercel-izi-finance-backend.vercel.app/api/admin/clear-sms-queue`
  - Preview: add `?dry=1`
  - Also delete Failed: add `&failed=1`
  - Disable endpoint: Vercel env `SMS_CLEAR_DISABLED=true` → 404

Update M-Pesa callback URLs to your Vercel domain after the first deploy:

| Env var | Example (production) |
|---------|----------------------|
| `MPESA_CONFIRM_URL` | `https://vercel-izi-finance-backend.vercel.app/api/c2b/confirm` |
| `MPESA_VALIDATE_URL` | `https://vercel-izi-finance-backend.vercel.app/api/c2b/validate` |

Then **re-register** C2B so Safaricom replaces the old URLs (no separate unregister). See [C2B.md](C2B.md): `npm run c2b:register` or `POST /api/c2b/register` on the deployed app. Until then, paybill payments still hit the previous host and **Vercel logs will not show** `[C2B_CONFIRM]`.

**Paybill account number** must be the borrower’s **National ID** (`Customer.idNumber`), not the paybill shortcode. The SMS from Safaricom (`Confirmed. Ksh… sent to … for account …`) is **only M-Pesa’s receipt**, not an IziFinance app notification.

## Crons vs Firebase

On **Vercel**, schedules are **QStash only** → `api/cron/[job].js`. See [QSTASH.md](QSTASH.md).

Firebase `onSchedule` for the same five jobs is **disabled** by default (`ENABLE_FIREBASE_SCHEDULED_CRONS` not set). Run `firebase deploy --only functions` after this change to remove old Cloud Scheduler triggers.

## Limitations on Vercel

- **SMS**: On Vercel there is **no BullMQ worker** — `sendSMS` only **stores** rows as `Pending` until **post-cron drain** calls Africa’s Talking. Default `CRON_SMS_DRAIN_ON` = `loan-reminder,reconciliation,group-health,monthly-group-repayment`. If a cron only shows `[SMS QUEUED]` with no `[SMS_DRAIN] Done`, messages stay Pending. `CRON_SMS_DRAIN=false` disables drain. Limits: `CRON_SMS_DRAIN_LIMIT` (25), `CRON_SMS_DRAIN_LIMIT_LOAN_REMINDER` (60), `CRON_SMS_DRAIN_MAX_MS` (50000). **Pre-cron purge** (default on): each cron **deletes** `Pending` / `Processing` / `Waiting for Balance` in `sms_queue` before the job runs (`[SMS_PURGE]`). Disable: `CRON_SMS_PURGE_PENDING=false`. Optional: `CRON_SMS_PURGE_MAX_AGE_MINUTES` (only delete older than N min), `CRON_SMS_PURGE_INCLUDE_FAILED=true`. Provider errors return in `smsDrain.errors` with `code`, `statusCode`, `providerStatus`. **`INSUFFICIENT_BALANCE` / statusCode 405** = top up Africa’s Talking SMS wallet. Long-lived **BullMQ worker** still runs on Firebase `api`.
- **Puppeteer / PDF** may need extra setup (e.g. `@sparticuz/chromium`) for serverless; test report/PDF routes after deploy.
- **Hobby plan**: `memory` is capped at **2048 MB** and `maxDuration` at **60s** in `vercel.json`. Upgrade to Pro for more memory/time; use Firebase for long PDF/cron jobs if needed.

## Firebase (unchanged)

```bash
npm run serve    # emulators
npm run deploy   # Firebase functions (+ hosting if configured)
```
