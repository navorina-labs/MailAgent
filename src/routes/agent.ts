/** REST for AI agents: verify + recipes */
import { Hono } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import {
  getAgentFlowTemplate,
  getAgentRecipe,
  listAgentFlowTemplates,
  listAgentRecipes,
  resolveAgentLabel,
} from "../lib/agent-recipes";
import { scopeLabelForCreate, scopeWriteDenied } from "../lib/scope-guard";
import { publicOriginFromUrl, workspaceUrl } from "../lib/public-origin";
import { SERVICE_EXPECT_FROM } from "../lib/service-presets";
import { suggestPreset, type PresetAdviceInput } from "../lib/preset-advisor";
import {
  buildAgentAutopilotPlan,
  type AgentAutopilotInput,
} from "../lib/agent-autopilot";
import { issueAgentAccess, type AgentAccessInput } from "../services/agent-access";
import { runAgentVerify } from "../services/agent-verify";
import { buildInboxDiagnose } from "../services/inbox-diagnose";
import { listAgentRuns } from "../services/agent-runs";
import {
  getAgentRunSession,
  patchAgentRunSession,
  sessionOwnerKey,
} from "../services/agent-run-session";
import {
  nextAgentRun,
  reportAgentRun,
  startAgentRun,
  type AgentRunNextInput,
  type AgentRunReportInput,
  type AgentRunStartInput,
} from "../services/agent-run-workflow";
import { validateRunId } from "../lib/validate-run-id";
import { MCP_SERVER_INFO, MCP_TOOL_NAMES } from "../mcp/manifest";
import { isOidcEnabled } from "../services/oidc-oauth";
import {
  countActiveInboxesForHint,
  countActiveInboxesForTeam,
} from "../services/inbox";
import { NPM_PACKAGES } from "../lib/npm-versions";

export const agentRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

agentRoutes.use("*", requireApiKey);
agentRoutes.use("*", rateLimit);

type VerifyBody = {
  inboxId?: string;
  ttlMinutes?: number;
  service?: string;
  flow?: "signup" | "login" | "password_reset";
  expectFrom?: string | string[];
  allowedSenders?: string | string[];
  label?: string;
  callbackUrl?: string;
  subjectContains?: string;
  messageIndex?: number;
  timeoutSeconds?: number;
  deleteAfter?: boolean;
  deleteAfterSuccess?: boolean;
  deleteAfterMinutes?: number;
  keepOnFailure?: boolean;
  runId?: string;
};

agentRoutes.get("/", (c) => {
  const oidc = isOidcEnabled(c.env);
  return c.json({
    name: "MailAgent Agent API",
    version: MCP_SERVER_INFO.version,
    auth: {
      oidc: oidc ? "enabled" : "disabled",
      me: "GET /v1/me",
      mcpAuth: "GET /mcp/auth",
      oidcDocs: oidc
        ? workspaceUrl("/docs/oauth-idp.html", c.env.MAILAGENT_WORKSPACE_ORIGIN)
        : workspaceUrl("/docs/agents.html#mcp-oauth", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    },
    recommended: {
      verify: {
        method: "POST",
        path: "/v1/agent/verify",
        runSession: "pass runId → response includes session",
        cleanupPolicy:
          "deleteAfterSuccess, keepOnFailure, deleteAfterMinutes; deleteAfter remains supported",
      },
      oneShot: { method: "POST", path: "/v1/inboxes/open" },
      rawMessage: {
        method: "GET",
        path: "/v1/inboxes/:id/messages/:messageId/raw",
      },
      presetAdvisor: {
        method: "POST",
        path: "/v1/agent/preset-advice",
        note: "Suggest service, expectFrom, subjectContains, and flow from a sample auth email.",
      },
      autopilot: {
        method: "POST",
        path: "/v1/agent/autopilot",
        note: "Return the next best agent action and ready MCP/REST payloads.",
      },
      accessBroker: {
        method: "POST",
        path: "/v1/agent/access",
        note: "Issue a short-lived scoped key for one autonomous agent run (team admin key required).",
      },
    },
    mcpTools: MCP_TOOL_NAMES,
    services: Object.keys(SERVICE_EXPECT_FROM),
    recipes: "/v1/agent/recipes",
    flowTemplates: {
      list: "GET /v1/agent/flows",
      detail: "GET /v1/agent/flows/:flow",
      ids: listAgentFlowTemplates().map((f) => f.id),
    },
    runs: {
      list: "GET /v1/agent/runs",
      detail: "GET /v1/agent/runs/:runId (includes session)",
      start: "POST /v1/agent/runs/start",
      next: "POST /v1/agent/runs/:runId/next",
      report: "POST /v1/agent/runs/:runId/report",
      session: {
        get: "GET /v1/agent/runs/:runId/session",
        patch: "PATCH /v1/agent/runs/:runId/session",
      },
      timeline: "GET /v1/agent/runs/:runId/timeline",
    },
    remoteMcp: {
      endpoint: "POST /mcp",
      streamableHttp: "Mcp-Session-Id on initialize (JWT, no KV when API_KEY set)",
      sse: "GET /mcp",
      oauth: {
        token: "POST /v1/oauth/token",
        discovery: "/.well-known/oauth-protected-resource/mcp",
      },
      auth: "GET /mcp/auth",
    },
    docs: workspaceUrl("/docs/agents.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    distribution: {
      status: "https://github.com/navorina-labs/MailAgent/blob/main/docs/DISTRIBUTION-STATUS.md",
      skill: {
        path: "skills/mailagent/SKILL.md",
        install: "npx skills add navorina-labs/MailAgent --skill mailagent",
        ghPin: "gh skill install navorina-labs/MailAgent mailagent --pin skills-0.2.5",
      },
      codex: {
        marketplace: "navorina-labs/MailAgent",
        plugin: "mailagent",
        catalogPr: "https://github.com/hashgraph-online/awesome-codex-plugins/pull/195",
      },
      skillsCatalogPr: "https://github.com/VoltAgent/awesome-agent-skills/pull/659",
    },
    packages: NPM_PACKAGES,
    console: workspaceUrl("/dashboard.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    billing: workspaceUrl("/docs/billing.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    enterprise: workspaceUrl("/docs/enterprise.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    security: workspaceUrl("/docs/security.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    privacy: workspaceUrl("/privacy.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    terms: workspaceUrl("/terms.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    dedicatedDomains: workspaceUrl("/docs/dedicated-domains.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    autotests: workspaceUrl("/docs/autotests.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    tests: {
      prodGateCi: "npm run test:prod:gate",
      prodGate: "npm run test:prod",
      env: ["MAILAGENT_API_URL", "MAILAGENT_API_KEY"],
      contractAll: "npm run test:contract:all",
      repoGuide: "https://github.com/navorina-labs/MailAgent/blob/main/docs/AUTOTESTS.md",
      qaPilot: "https://github.com/navorina-labs/MailAgent/blob/main/docs/QA-PILOT.md",
      qaPilotStarter: "https://github.com/navorina-labs/MailAgent/tree/main/examples/qa-pilot-starter",
      qaPilotCypressStarter:
        "https://github.com/navorina-labs/MailAgent/tree/main/examples/qa-pilot-cypress-starter",
      qaWizard: "npm run wizard:qa-pilot:onboard",
      smokeQa: "npm run smoke:qa",
    },
    cli: "npx @mailagent/mcp mailagent open --service github --json",
  });
});

agentRoutes.get("/recipes", (c) => {
  return c.json({ recipes: listAgentRecipes() });
});

agentRoutes.get("/flows", (c) => {
  return c.json({ flows: listAgentFlowTemplates() });
});

agentRoutes.get("/flows/:flow", (c) => {
  const template = getAgentFlowTemplate(c.req.param("flow"));
  if (!template) return c.json({ error: "unknown_flow" }, 404);
  return c.json(template);
});

agentRoutes.post("/preset-advice", async (c) => {
  let body: PresetAdviceInput = {};
  try {
    body = await c.req.json<PresetAdviceInput>();
  } catch {
    body = {};
  }
  return c.json(suggestPreset(body));
});

agentRoutes.post("/autopilot", async (c) => {
  let body: AgentAutopilotInput = {};
  try {
    body = await c.req.json<AgentAutopilotInput>();
  } catch {
    body = {};
  }
  const status = body.status?.trim().toLowerCase();
  const shouldDiagnose =
    Boolean(body.inboxId) && (status === "timeout" || status === "failed");
  const diagnose = shouldDiagnose
    ? await buildInboxDiagnose(c.env, body.inboxId!, {
        subjectContains: body.subjectContains,
        messageIndex: body.messageIndex,
        apiBaseUrl: publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN),
        apiKeyHint: c.get("apiKeyHint"),
      })
    : null;
  return c.json(buildAgentAutopilotPlan(body, diagnose));
});

agentRoutes.post("/access", async (c) => {
  let body: AgentAccessInput = {};
  try {
    body = await c.req.json<AgentAccessInput>();
  } catch {
    body = {};
  }

  const result = await issueAgentAccess(
    c.env,
    {
      teamId: c.get("teamId"),
      plan: c.get("apiPlan"),
      scope: c.get("apiKeyScope"),
    },
    body
  );
  if (!result.ok) {
    return c.json(
      {
        error: result.error,
        ...(result.hint ? { hint: result.hint } : {}),
        ...(result.max ? { max: result.max } : {}),
      },
      result.status
    );
  }
  return c.json(result, 201);
});

agentRoutes.get("/recipes/:service", (c) => {
  const flowRaw = c.req.query("flow")?.trim().toLowerCase();
  const flow =
    flowRaw === "login" || flowRaw === "password_reset"
      ? flowRaw
      : "signup";
  const recipe = getAgentRecipe(c.req.param("service"), flow);
  if (!recipe) return c.json({ error: "unknown_service" }, 404);
  return c.json({ ...recipe, flow });
});

/** Active agent runs (label agent-*) */
agentRoutes.get("/runs", async (c) => {
  const limit = Number(c.req.query("limit") ?? "30");
  const runId = c.req.query("runId") ?? undefined;
  const label = c.req.query("label") ?? undefined;
  const runs = await listAgentRuns(c.env, c.get("apiKeyHint"), {
    limit,
    runId,
    label,
  });
  return c.json({ runs });
});

agentRoutes.post("/runs/start", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: AgentRunStartInput = {};
  try {
    body = await c.req.json<AgentRunStartInput>();
  } catch {
    body = {};
  }

  try {
    const result = await startAgentRun(
      c.env,
      {
        ownerKey: sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint")),
        teamId: c.get("teamId"),
        apiKeyHint: c.get("apiKeyHint"),
        apiBaseUrl: publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN),
      },
      body
    );
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json(result, 201);
  } catch (e) {
    if (e instanceof Error && e.message === "invalid_run_id") {
      return c.json({ error: "invalid_run_id" }, 400);
    }
    throw e;
  }
});

agentRoutes.post("/runs/:runId/next", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: AgentRunNextInput = {};
  try {
    body = await c.req.json<AgentRunNextInput>();
  } catch {
    body = {};
  }

  try {
    const result = await nextAgentRun(
      c.env,
      {
        ownerKey: sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint")),
        teamId: c.get("teamId"),
        apiKeyHint: c.get("apiKeyHint"),
        apiBaseUrl: publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN),
      },
      c.req.param("runId"),
      body
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "invalid_run_id") {
      return c.json({ error: "invalid_run_id" }, 400);
    }
    throw e;
  }
});

agentRoutes.post("/runs/:runId/report", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: AgentRunReportInput = {};
  try {
    body = await c.req.json<AgentRunReportInput>();
  } catch {
    body = {};
  }

  try {
    const result = await reportAgentRun(
      c.env,
      {
        ownerKey: sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint")),
        teamId: c.get("teamId"),
        apiKeyHint: c.get("apiKeyHint"),
        apiBaseUrl: publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN),
      },
      c.req.param("runId"),
      body
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "invalid_run_id") {
      return c.json({ error: "invalid_run_id" }, 400);
    }
    throw e;
  }
});

agentRoutes.get("/runs/:runId/session", async (c) => {
  const runId = c.req.param("runId");
  if (!validateRunId(runId)) {
    return c.json({ error: "invalid_run_id" }, 400);
  }
  const owner = sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint"));
  const session = await getAgentRunSession(c.env, runId, owner);
  if (!session) return c.json({ error: "session_not_found" }, 404);
  return c.json(session);
});

agentRoutes.get("/runs/:runId/timeline", async (c) => {
  const runId = c.req.param("runId");
  if (!validateRunId(runId)) {
    return c.json({ error: "invalid_run_id" }, 400);
  }
  const owner = sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint"));
  const session = await getAgentRunSession(c.env, runId, owner);
  if (!session) return c.json({ error: "session_not_found" }, 404);
  return c.json({
    runId: session.runId,
    timeline: session.timeline,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
});

type SessionPatchBody = {
  merge?: Record<string, unknown>;
  replaceState?: Record<string, unknown>;
  step?: { name: string; data?: Record<string, unknown> };
};

agentRoutes.patch("/runs/:runId/session", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const runId = c.req.param("runId");
  if (!validateRunId(runId)) {
    return c.json({ error: "invalid_run_id" }, 400);
  }

  let body: SessionPatchBody = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  const owner = sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint"));
  const result = await patchAgentRunSession(c.env, runId, owner, body);
  if (!result.ok) {
    return c.json({ error: result.error }, 400);
  }
  return c.json(result.session);
});

agentRoutes.get("/runs/:runId", async (c) => {
  const runId = c.req.param("runId");
  if (!validateRunId(runId)) {
    return c.json({ error: "invalid_run_id" }, 400);
  }
  const runs = await listAgentRuns(c.env, c.get("apiKeyHint"), {
    runId: c.req.param("runId"),
    limit: 50,
  });
  const run = runs[0];
  if (!run) return c.json({ error: "run_not_found" }, 404);
  const owner = sessionOwnerKey(c.get("teamId"), c.get("apiKeyHint"));
  const session = await getAgentRunSession(c.env, runId, owner);
  return c.json({ ...run, session: session ?? null });
});

agentRoutes.post("/verify", async (c) => {
  let body: VerifyBody = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }

  if (!body.inboxId) {
    const writeErr = scopeWriteDenied(c);
    if (writeErr) return writeErr;
    const agentLabel = resolveAgentLabel({
      label: body.label,
      runId: body.runId,
    });
    const labelCheck = scopeLabelForCreate(c, agentLabel);
    if (labelCheck instanceof Response) return labelCheck;
    body = { ...body, label: labelCheck.label ?? undefined };
  }

  if (!body.inboxId) {
    const teamId = c.get("teamId");
    const active = teamId
      ? await countActiveInboxesForTeam(c.env, teamId)
      : await countActiveInboxesForHint(c.env, c.get("apiKeyHint"));
    const max = c.get("maxActiveInboxes");
    if (active >= max) {
      return c.json(
        {
          error: "inbox_limit_reached",
          plan: c.get("apiPlan"),
          active,
          max,
        },
        429
      );
    }
  }

  const result = await runAgentVerify(c.env, {
    ...body,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
    apiBaseUrl: publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN),
  });

  if ("error" in result && result.error === "invalid_callback_url") {
    return c.json(result, 400);
  }
  if (
    "error" in result &&
    (result.error === "inbox_not_found" ||
      result.error === "domain_not_found")
  ) {
    return c.json(result, 404);
  }
  if (
    "error" in result &&
    (result.error === "domain_not_verified" ||
      result.error === "username_requires_domain")
  ) {
    return c.json(result, 400);
  }
  if ("status" in result && result.status === "timeout") {
    return c.json(result, 408);
  }

  return c.json(result, "statusCode" in result ? result.statusCode : 200);
});
