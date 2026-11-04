/** OpenAPI JSON for agents and codegen */
import { Hono } from "hono";
import type { Env } from "../env";
import { publicOriginFromUrl } from "../lib/public-origin";
import { openApiSpec } from "../openapi/spec";

export const openapiRoutes = new Hono<{ Bindings: Env }>();

openapiRoutes.get("/openapi.json", (c) => {
  const hostedOrigin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  return c.json({
    ...openApiSpec,
    servers: [
      { url: hostedOrigin, description: "Hosted" },
      { url: "http://127.0.0.1:8787", description: "Local wrangler dev" },
    ],
  });
});
