# Upstash QStash scheduled jobs (Vercel)

Production API: `https://vercel-izi-finance-backend.vercel.app` (override with `CRON_BASE_URL`).

Firebase `onSchedule` jobs in [`functions/index.js`](functions/index.js) are **unchanged** — the same work may also run on Firebase. QStash is the scheduler for the **Vercel** deployment.

## Jobs

| Slug | Path | Cron (Africa/Nairobi) |
|------|------|-------------------------|
| `loan-reminder` | `/api/cron/loan-reminder` | 18:00 daily |
| `reconciliation` | `/api/cron/reconciliation` | 18:15 daily |
| `group-health` | `/api/cron/group-health` | 00:00 on day 1 monthly |
| `monthly-group-repayment` | `/api/cron/monthly-group-repayment` | 01:00 on day 1 monthly |
| `credit-score-recovery` | `/api/cron/credit-score-recovery` | 00:30 on day 1 monthly |
| `lender-cron-test` | `/api/cron/lender-cron-test` | **Every 5 min** (smoke test) |

### `lender-cron-test` (optional)

SMS **lenders only** (`User` with `role: "lender"`). Safe to push without spamming:

- Without `CRON_TEST_SMS=true` → **dry run** (200, no SMS).
- `CRON_TEST_SMS=true` → sends Africa’s Talking SMS to all lenders with valid phones.
- `CRON_TEST_LENDER_PHONES=+254...,+254...` → limit to those numbers (recommended while testing).

Pause or delete this schedule in Upstash when you finish testing.

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