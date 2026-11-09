# Billing

Full Stripe go-live: **[STRIPE-SETUP.md](./STRIPE-SETUP.md)** · `npm run wizard:stripe`

## Without Stripe (current)

Stripe **not required**. Do not set `STRIPE_*` secrets — billing stays disabled.

**Option A — single hosted key (simplest):**

```bash
npm run issue:key
npx wrangler secret put API_KEY   # or API_KEYS
```

**Legacy** plan: 120 req/min, up to 500 active inboxes.

**Option B — key in Neon (free, for pilots with `team_id`):**

```bash
npm run issue:key:db -- pilot-name
```

**Free** plan: 60 req/min, 10 inboxes. Pro manually:

```bash
npm run team:plan -- TEAM_ID pro
```

`team_id` visible in `GET /v1/me` or `issue:key:db` output.

Dashboard and API work without Upgrade button.

---

## Stripe Pro (when available)

## Plans

| Plan | Price | Rate limit | Active inboxes | Emails / month |
|------|-------|------------|----------------|----------------|
| free | $0 | 60/min | 10 | 500 |
| pro | $29/month | 300/min | 100 | 5000 |
| enterprise | operator | 600/min | 500 | no cap |
| legacy | operator | 120/min | 500 (wrangler `API_KEY` only) | no cap |

Emails per month count outbound sends and inbound messages fetched from Resend (UTC calendar month, table `team_email_usage`). Over the cap: send returns `429 monthly_quota_exceeded`, inbound is dropped.

## New key in DB

```bash
npm run issue:key:db -- acme-corp
```

Key stored in `teams` + `api_keys`. Do not duplicate in `API_KEYS`.

## Stripe (hosted)

1. Stripe Dashboard → Product → Price (subscription) → copy `price_…`
2. Webhook: `https://api.webmailagent.com/webhooks/stripe`  
   Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
3. Secrets: `npm run wizard:stripe` → `npm run setup:stripe-prod`
4. Verify: `npm run doctor:billing` · `npm run test:contract:qa:billing`
5. Self-serve: [upgrade.html](https://webmailagent.com/upgrade.html) (email link, no API key in the browser)
6. UI: [dashboard.html](https://webmailagent.com/dashboard.html) · [billing.html](https://webmailagent.com/docs/billing.html)
