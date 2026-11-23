# M-Pesa C2B (paybill) URL registration

**Sandbox:** calling **Register URL** again **overwrites** the previous URLs.

**Production (live):** if URLs were already registered (e.g. Firebase), Daraja often returns **`500.003.1001`** until you **delete** the old URLs: **Daraja portal → Self Service → URL Management** → remove Validation + Confirmation for paybill `4955880` (Business Manager / Administrator approval may be required), then register again. There is no public “unregister” API for live.

## 1. Set Vercel environment variables (Production)

Use your live paybill shortcode and Daraja credentials (`MPESA_ENV=live`).

| Variable | Example |
|----------|---------|
| `MPESA_CONFIRM_URL` | `https://vercel-izi-finance-backend.vercel.app/api/c2b/confirm` |
| `MPESA_VALIDATE_URL` | `https://vercel-izi-finance-backend.vercel.app/api/c2b/validate` |
| `CRON_BASE_URL` | `https://vercel-izi-finance-backend.vercel.app` (fallback if URLs above are empty) |
| `MPESA_SHORTCODE` | Your paybill number |
| `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET` | Daraja app keys |

Redeploy Vercel after changing env vars.

## 2. Register (pick one)

### A) From your machine (uses `.env`)

```bash
npm run c2b:register
```

Override API host without editing `.env`:

```bash
npm run c2b:register -- --base https://vercel-izi-finance-backend.vercel.app
```

Ensure local `.env` has `MPESA_CONFIRM_URL` and `MPESA_VALIDATE_URL` pointing at Vercel (or rely on `--base` + fallbacks).

### B) Hit production API after deploy

```bash
curl -s -X POST "https://vercel-izi-finance-backend.vercel.app/api/c2b/register" | jq
```

The handler reads `MPESA_*` from Vercel env and calls Safaricom.

## Troubleshooting `500.003.1001`

| Cause | What to do |
|--------|------------|
| **URLs already registered (live)** | Delete in **URL Management**, then `npm run c2b:register` again |
| **C2B v1 vs v2** | Daraja → **My Apps** → API Products: use matching endpoint (`npm run c2b:register -- --v1` or `--v2`) |
| **Safaricom outage** | Retry later; OAuth should still print `Daraja OAuth: OK` |
| **Old aggregator/MPLS URLs** | Ask Safaricom support to clear duplicate registration |

## 3. Verify

- Response JSON: `success: true` and `safaricomResponse` with `ResponseDescription` like success.
- Paybill test payment → Vercel logs should show `[C2B_VALIDATE]` and `[C2B_CONFIRM]`.
- Health: `GET …/api/c2b/health`

## Paybill account number

Customers must enter their **National ID** (`Customer.idNumber`) as the paybill **Account Number**, not the paybill business/shortcode.