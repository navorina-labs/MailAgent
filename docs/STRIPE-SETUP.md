# Stripe setup (Pro self-serve)

MailAgent billing is **optional**. Without all three `STRIPE_*` secrets the API returns `stripe_not_configured` and teams stay on **free** (or operator-assigned **pro** / **enterprise**). The landing and `/upgrade` show "Request Pro" until `GET /v1/upgrade/config` returns `{"billing": true}`.

Price: **Pro $29/month**. `wizard:stripe` and `doctor:billing` reject any other price.

When you have a Stripe account, follow this once — same pattern as OIDC (`wizard:auth0`).

## What you get

| Plan | How |
|------|-----|
| **free** | Default for `issue:key:db` and self-serve `/get-key` teams. 500 emails/month |
| **pro** | $29/month. Stripe Checkout → webhook sets `teams.plan = pro`. 5000 emails/month |
| **enterprise** | Operator only: `npm run team:plan -- TEAM_ID enterprise` (not Stripe self-serve yet) |
| **legacy** | Single wrangler `API_KEY` (no team billing) |

## Quick path (operator)

```bash
# 1) Dashboard checklist + save keys to .dev.vars
npm run wizard:stripe

# 2) Push secrets to Cloudflare Worker
npm run wizard:stripe -- --deploy
# or: npm run setup:stripe-prod

# 3) Verify
npm run doctor:billing
npm run test:contract:qa:billing
```

## Stripe Dashboard (test mode first)

### 1. Product + Price

1. [Stripe Dashboard](https://dashboard.stripe.com) → **Product catalog** → **Add product**
2. Name: `MailAgent Pro`
3. Pricing: **Recurring**, **29.00 USD**, **Monthly**
4. Copy **Price ID** → `price_…` → `STRIPE_PRICE_PRO`

Use **test mode** keys (`sk_test_…`, `price_…` from test catalog) until go-live.

### 2. Customer Portal

**Settings → Billing → Customer portal** → enable:

- Cancel subscription
- Update payment method
- Invoice history

Return URL is set by API (`dashboard.html?billing=portal`).

### 3. Webhook

**Developers → Webhooks → Add endpoint**

| Field | Value |
|-------|--------|
| URL | `https://api.webmailagent.com/webhooks/stripe` |
| Events | `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` |

Copy **Signing secret** → `whsec_…` → `STRIPE_WEBHOOK_SECRET`

**Local dev** (optional):

```bash
stripe listen --forward-to http://127.0.0.1:8787/webhooks/stripe
# use the whsec_ from CLI output in .dev.vars for local only
```

### 4. API key

**Developers → API keys** → Secret key (`sk_test_…` or restricted `rk_test_…`)

Recommended: [restricted key](https://docs.stripe.com/keys/restricted-api-keys) with:

- Checkout Sessions: Write
- Customers: Write
- Billing Portal: Write
- Prices: Read

→ `STRIPE_SECRET_KEY`

## Secrets map

| Secret | Where |
|--------|--------|
| `STRIPE_SECRET_KEY` | wrangler secret + optional `.dev.vars` |
| `STRIPE_WEBHOOK_SECRET` | wrangler secret + optional `.dev.vars` |
| `STRIPE_PRICE_PRO` | wrangler secret + optional `.dev.vars` |

`.dev.vars` is for local `wrangler dev` and `setup:stripe-prod` — never commit.

## Client flow

### Self-serve (no API key in the browser)

1. Free key from [/get-key](https://webmailagent.com/get-key.html) (team name = email)
2. [/upgrade](https://webmailagent.com/upgrade.html): email + "Upgrade to Pro" or "Manage subscription"
3. `POST /v1/upgrade/request { email, action: "checkout" | "portal" }` emails a one-time link (30 min). Same 202 answer for unknown emails
4. Link opens `/upgrade.html#t=…` → `POST /v1/upgrade/confirm { token }` → `{ url }` → Stripe Checkout or Customer Portal
5. Webhook → `teams.plan = pro`; cancel or any status other than `active` / `trialing` → `free`

### With an API key (dashboard)

1. Team key from `npm run issue:key:db -- acme`
2. `GET /v1/me` → `billing.stripeEnabled`, `billing.canUpgrade`
3. `POST /v1/billing/checkout` (admin scope) → `{ url }` → Stripe Checkout
4. Webhook → `teams.plan = pro`
5. `POST /v1/billing/portal` → Customer Portal

Dashboard: [dashboard.html](https://webmailagent.com/dashboard.html) — **Upgrade to Pro** / **Manage billing**.

## Go-live checklist

- [ ] Switch Dashboard to **live mode**
- [ ] Create live Product + Price → update `STRIPE_PRICE_PRO`
- [ ] Live webhook endpoint (same URL)
- [ ] Live `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- [ ] `npm run setup:stripe-prod`
- [ ] `npm run doctor:billing` (prod shows `stripeEnabled: true`)
- [ ] Test checkout with real card → confirm `GET /v1/me` plan `pro`
- [ ] Cancel in portal → confirm downgrade to `free`

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `stripe_not_configured` | Missing `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO` or `STRIPE_WEBHOOK_SECRET` on Worker |
| `monthly_quota_exceeded` (429) | Team used its monthly emails (Free 500, Pro 5000, UTC month). Table `team_email_usage` |
| `invalid_stripe_signature` | Wrong `STRIPE_WEBHOOK_SECRET` or raw body modified |
| Upgrade button missing | Need registered team key + free plan + Stripe configured |
| `billing_requires_registered_key` | `npm run issue:key:db` (not legacy `API_KEY` only) |
| Plan stuck on free after pay | Check webhook delivery in Stripe Dashboard; events above subscribed |

## Related

- [BILLING.md](./BILLING.md) — plans without Stripe
- [YOUR-TURN.md](./YOUR-TURN.md) — operator secrets
- [public/docs/billing.html](https://webmailagent.com/docs/billing.html)
