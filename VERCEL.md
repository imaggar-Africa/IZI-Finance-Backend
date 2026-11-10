# Deploy IZI Finance Backend on Vercel

Firebase setup is unchanged (`firebase.json`, `functions/index.js`, `npm run deploy`).

Root `vercel.json` uses a **single** `services.izi-backend` entry (required by Vercel’s Services import UI). Do **not** use “Import single project” on `functions/` or `app/` in the dashboard—deploy from the repo root only.

## Quick start

1. Install dependencies: `npm install`
2. Link the project: `npx vercel link`
3. Copy environment variables from your Firebase secrets / local `.env` into the Vercel project (**Settings → Environment Variables**). Use the same names as in `functions/index.js` / `.env` (e.g. `MONGO_URI`, `JWT_ACCESS_SECRET`, `MPESA_*`, `CLIENT_EMAIL`, `FB_PRIVATE_KEY`, `PROJECT_ID`, `STORAGE_BUCKET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, Africa's Talking vars).
4. Set `CRON_SECRET` to a long random string (required for Vercel Cron jobs in `vercel.json`).
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

Scheduled tasks still run on Firebase when you use `firebase deploy`. On Vercel, equivalent jobs are defined in `vercel.json` and hit `api/cron/[job].js` (protected by `CRON_SECRET`). You can keep crons on Firebase only, use Vercel only, or run both—avoid duplicate schedules unless intended.

## Limitations on Vercel

- **SMS BullMQ worker** does not run in serverless by default. Set `ENABLE_SMS_WORKER=true` only if you accept a long-lived worker on a plan that supports it; otherwise keep the worker on Firebase or a separate process.
- **Puppeteer / PDF** may need extra setup (e.g. `@sparticuz/chromium`) for serverless; test report/PDF routes after deploy.
- **Function timeout**: `maxDuration` is 300s in `vercel.json` (Pro). Hobby is capped lower—reduce or upgrade if requests time out.

## Firebase (unchanged)

```bash
npm run serve    # emulators
npm run deploy   # Firebase functions (+ hosting if configured)
```
