# Hosting everything on Cloudflare (without Netlify)

Landing (`public/`), API and webhook — one Worker. Free tier is usually enough to start.

## Already working

- https://api.webmailagent.com — API + health
- https://mailagent.alex-young33rd.workers.dev/ — landing + API

After DNS migration:

- https://webmailagent.com — landing
- https://www.webmailagent.com — redirect to apex
- https://agents.navorina.ai — Navorina workspace compatibility hostname

## Step 1 — Custom domains on Worker

**Workers & Pages** → **mailagent** → **Domains** → **+ Add domain**

| Subdomain | Domain |
|-----------|--------|
| *(empty)* | `webmailagent.com` |
| `www` | `www.webmailagent.com` |
| `agents` in the `navorina.ai` zone | `agents.navorina.ai` |

`api.webmailagent.com` should already be in the list.

## Step 2 — Remove Netlify DNS

**Cloudflare** → **DNS** → **Records**, delete:

- **A** `webmailagent.com` → `75.2.60.5` (Netlify)
- **CNAME** `www` → `alex0nder-mailagent.netlify.app`

Custom domain on Worker will create new records (wait 2–5 min).

## Step 3 — Deploy

```bash
npm run deploy
```

## Step 4 — Verify

```bash
curl -sI https://webmailagent.com | head -5
curl -sI http://webmailagent.com | grep -i location   # should be 301 → https
curl -s https://api.webmailagent.com/health
```

### HTTPS / "Connection not secure"

Cloudflare certificate for apex usually appears within minutes after Custom Domain.

If Chrome says "not secure" but menu shows "Valid certificate" — you are on **http://**, not **https://**.

1. **Cloudflare** → **SSL/TLS** → **Edge Certificates** → enable **Always Use HTTPS**
2. Worker already redirects `http` → `https` (see `src/index.ts`)
3. Open `https://webmailagent.com` or update bookmark

## Netlify

Netlify site can be **disabled** or custom domain removed — to avoid confusion. Repo and `netlify.toml` can stay as fallback.

## Cost

| Component | Where | Free tier |
|-----------|-----|-----------|
| Worker + Assets | Cloudflare | ~100k req/day |
| Durable Objects, Queues | Cloudflare | limits apply |
| Postgres | Neon | separate |
| Inbound mail | Resend | separate |

## Agent access

MCP does not manage DNS. Deploy from machine:

```bash
npx wrangler whoami
npm run deploy
```
