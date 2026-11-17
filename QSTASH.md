# Upstash QStash scheduled jobs (Vercel)

Production API: `https://vercel-izi-finance-backend.vercel.app` (override with `CRON_BASE_URL`).

Use **one QStash region** for schedules and Vercel signing keys (EU **or** US). If you switch regions, run `npm run qstash:schedules -- --force` and **pause** schedules in the old region’s Upstash console.

**Firebase:** The five matching `onSchedule` exports in [`functions/index.js`](functions/index.js) are **off** unless you set `ENABLE_FIREBASE_SCHEDULED_CRONS=true` on Firebase and redeploy functions. Production crons for these jobs are **QStash → Vercel only**.

## Jobs

| Slug | Path | Cron (Africa/Nairobi) |
|------|------|-------------------------|
| All jobs below | `/api/cron/{slug}` | **Every 10 minutes** (`*/10 * * * *`) |

| Slug | Path |
|------|------|
| `loan-reminder` | `/api/cron/loan-reminder` |
| `reconciliation` | `/api/cron/reconciliation` |
| `group-health` | `/api/cron/group-health` |
| `monthly-group-repayment` | `/api/cron/monthly-group-repayment` |
| `credit-score-recovery` | `/api/cron/credit-score-recovery` |

**Warning:** `loan-reminder` / `reconciliation` every 10 minutes can send SMS or run heavy work often — use for **testing** only; restore production crons before go-live.

## 1. Upstash Console

1. [Upstash Console](https://console.upstash.com/) → your project → **QStash**.
2. Copy **QSTASH_TOKEN** (for creating schedules).
3. Copy **Current signing key** and **Next signing key** (for verifying requests on Vercel).

## 2. Vercel environment variables (Production)

| Variable | Required | Purpose |
|----------|----------|---------|
| `QSTASH_URL` | Yes if not default US | e.g. `https://qstash-eu-central-1.upstash.io` (local schedule script only; signing keys are region-specific) |
| `QSTASH_CURRENT_SIGNING_KEY` | Yes (for QStash) | Verify `Upstash-Signature` on `/api/cron/*` — **same region as schedules** |
| `QSTASH_NEXT_SIGNING_KEY` | Yes | Key rotation |
| `CRON_BASE_URL` | Yes | Public origin used in signature verify (`https://vercel-izi-finance-backend.vercel.app`) |
| `CRON_SECRET` | Optional | Manual `curl` with `Authorization: Bearer …` |
| `QSTASH_TOKEN` | No on Vercel | Only for local `npm run qstash:schedules` |
| All app secrets | Yes | `MONGO_URI`, M-Pesa, JWT, etc. — cron handlers call `initializeApp()` |

Redeploy after changing env vars.

## Fresh start (new QStash project)

1. **Upstash** → use **one** US (or EU) QStash project → Quickstart: copy **token + both signing keys**.
2. **Old projects** (every other account/team): **Schedules** → delete or pause anything pointing at `vercel-izi-finance-backend.vercel.app` (the CLI cannot touch other accounts).
3. **`.env`**: `QSTASH_URL`, `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, `CRON_BASE_URL`.
4. **Vercel Production**: same **two signing keys** + `CRON_BASE_URL` → **Redeploy**.
5. Wipe and recreate schedules on the **new** token:

```bash
npm run qstash:reset
```

6. **Run now** on `group-health` in Upstash → expect **200**.

Optional: **QStash → Settings → Rotate signing keys**, then update Vercel + `.env` again and redeploy.

## 3. Create schedules (CLI)

Local `.env` or shell:

```bash
QSTASH_TOKEN=...
CRON_BASE_URL=https://vercel-izi-finance-backend.vercel.app
npm run qstash:schedules
```

Recreate all (delete existing matching destinations first):

```bash
npm run qstash:schedules -- --force
```

Delete **every** schedule on the current token, then create the five jobs:

```bash
npm run qstash:reset
```

## 3b. Create schedules (Console)

**QStash → Schedules → Create** for each row in the table:

- **Destination:** `https://vercel-izi-finance-backend.vercel.app/api/cron/<slug>`
- **Method:** POST
- **Cron:** use `CRON_TZ=Africa/Nairobi …` as in the table (or equivalent in the UI)

## 4. Test

**Local (no deploy):**

```bash
node scripts/qstash-smoke.js
```

1. **QStash:** open a schedule → **Run now**.
2. **Vercel → Logs** for `api/cron/[job]`: expect HTTP 200 and job JSON.
3. **Manual (optional):**

```bash
curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://vercel-izi-finance-backend.vercel.app/api/cron/loan-reminder
```

## 5. Vercel native crons

Removed from [`vercel.json`](vercel.json). Do not re-add `crons` there while using QStash (avoids duplicate triggers with Firebase + QStash).

## Limits

- Vercel Hobby: cron handlers `maxDuration: 60` seconds — heavy jobs may need Pro or Firebase-only execution.
- Signature verification uses `CRON_BASE_URL`; must match the URL configured in QStash destinations exactly.