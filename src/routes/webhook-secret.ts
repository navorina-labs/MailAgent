/** GET /v1/webhook-secret: the secret that signs callbacks and team webhooks for this key's owner. */
import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import {
  SIGNATURE_HEADER,
  SIGNATURE_TOLERANCE_SECONDS,
  signingMaster,
  webhookOwner,
  webhookSecret,
} from "../lib/webhook-signature";

export const webhookSecretRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

webhookSecretRoutes.use("*", requireApiKey);
webhookSecretRoutes.use("*", rateLimit);

webhookSecretRoutes.get("/", async (c) => {
  if (c.get("apiKeyScope")?.readOnly) return c.json({ error: "insufficient_scope" }, 403);
  const master = signingMaster(c.env);
  const owner = webhookOwner(c.get("teamId"), c.get("apiKeyHint"));
  if (!master || !owner) return c.json({ error: "signing_unavailable" }, 503);
  return c.json({
    signingSecret: await webhookSecret(master, owner),
    header: SIGNATURE_HEADER,
    format: "t=<unix seconds>,v1=<hex HMAC-SHA256(signingSecret, \"<t>.<raw body>\")>",
    toleranceSeconds: SIGNATURE_TOLERANCE_SECONDS,
    docs: "https://webmailagent.com/docs/webhooks.html",
  });
});
