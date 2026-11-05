/** Workspace Agent API: safe mail/calendar assistant primitives. */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import type { ApiVariables } from "../lib/api-context";
import { requireApiKey } from "../lib/auth";
import { rateLimit } from "../lib/rate-limit";
import { scopeAdminDenied, scopeInboxDenied, scopeWriteDenied } from "../lib/scope-guard";
import { auditRoute } from "../services/audit-log";
import { getInbox } from "../services/inbox";
import {
  probeWorkspaceProviders,
  workspaceProviderInfo,
} from "../services/llm-provider";
import {
  completeWorkspaceReminder,
  createWorkspaceReminder,
  listWorkspaceReminders,
  type WorkspaceReminderInput as WorkspaceReminderCreateInput,
} from "../services/workspace-reminders";
import {
  listWorkspaceActions,
  logWorkspaceAction,
  type WorkspaceActionInput,
} from "../services/workspace-actions";
import {
  getWorkspaceAutonomyPolicy,
  setWorkspaceAutonomyPolicy,
  type WorkspaceAutonomyPolicyInput,
} from "../services/workspace-autonomy";
import {
  executeWorkspaceReply,
  type WorkspaceExecuteReplyInput,
} from "../services/workspace-execution";
import {
  draftWorkspaceReply,
  suggestWorkspaceReminders,
  summarizeWorkspaceThread,
  type WorkspaceDraftReplyInput,
  type WorkspaceReminderInput,
  type WorkspaceSummarizeInput,
} from "../services/workspace-agent";
import { resolveWorkspaceMailContext } from "../services/workspace-mail-context";
import { publicOriginFromUrl, resolveWorkspaceReturnTo } from "../lib/public-origin";
import {
  buildGmailAuthorizeUrl,
  exchangeGmailOAuthCode,
  gmailOAuthJwtSecret,
  isGmailOAuthConfigured,
  listUserMailAccounts,
  revokeUserMailAccount,
  upsertGmailAccount,
  GMAIL_READONLY_SCOPE,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_WRITE_SCOPES,
  buildGmailWriteAuthorizeUrl,
} from "../services/user-mail-accounts";
import { signGmailOAuthPending, verifyGmailOAuthPending } from "../lib/gmail-oauth-jwt";
import { listGmailThreads, readGmailThread } from "../services/gmail-read";
import { buildGmailDailyDigest, triageGmailInbox } from "../services/gmail-triage";
import {
  getWorkspaceGmailSettings,
  setWorkspaceGmailSettings,
  type WorkspaceGmailSettingsInput,
} from "../services/workspace-gmail-settings";
import { workspaceOwnerKey } from "../services/workspace-reminders";
import {
  buildCalendarAuthorizeUrl,
  buildCalendarWriteAuthorizeUrl,
  CALENDAR_READONLY_SCOPE,
  CALENDAR_CONNECT_SCOPES,
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_WRITE_SCOPES,
  calendarOAuthJwtSecret,
  exchangeCalendarOAuthCode,
  isCalendarOAuthConfigured,
  listUserCalendarAccounts,
  revokeUserCalendarAccount,
  upsertCalendarAccount,
} from "../services/user-calendar-accounts";
import {
  signCalendarOAuthPending,
  verifyCalendarOAuthPending,
} from "../lib/gmail-oauth-jwt";
import {
  buildCalendarDailyAgenda,
  checkCalendarConflicts,
  getCalendarAvailability,
  listCalendarEventsForAccount,
  suggestCalendarMeetingFromThread,
} from "../services/calendar-workspace";
import {
  executeWorkspaceCalendarEvent,
  executeWorkspaceGmailDraft,
} from "../services/workspace-external-write";
import {
  createWorkspaceMonitor,
  deleteWorkspaceMonitor,
  getWorkspaceMonitorRow,
  listWorkspaceMonitorRuns,
  listWorkspaceMonitors,
  type WorkspaceMonitorInput,
} from "../services/workspace-monitors";
import {
  createWorkspaceAutomationRule,
  deleteWorkspaceAutomationRule,
  getWorkspaceRulesStatus,
  listWorkspaceAutomationRules,
  type WorkspaceAutomationRuleInput,
} from "../services/workspace-automation-rules";
import {
  evaluateWorkspaceRulesForGmail,
  runWorkspaceMonitorById,
} from "../services/workspace-monitor-runner";
import type { WorkspaceRuleKind } from "../services/workspace-rule-engine";
import {
  decideWorkspaceActionCandidate,
  listWorkspaceActionCandidates,
  type WorkspaceCandidateStatus,
} from "../services/workspace-action-candidates";

export const workspaceRoutes = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

const GOOGLE_WORKSPACE_OAUTH_DISABLED = true;

function googleWorkspaceOAuthDisabled(
  c: Context<{ Bindings: Env; Variables: ApiVariables }>
) {
  return c.json(
    {
      error: "google_workspace_oauth_disabled",
      hint: "Google Gmail/Calendar OAuth is disabled while CASA assessment is not being pursued.",
    },
    410
  );
}

/** Public OAuth callbacks — validated via signed state JWT */
workspaceRoutes.get("/gmail/callback", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const code = c.req.query("code")?.trim();
  const state = c.req.query("state")?.trim();
  const oauthError = c.req.query("error")?.trim();

  if (oauthError) {
    return c.json({ error: oauthError, phase: "gmail_oauth_denied" }, 400);
  }
  if (!code || !state) {
    return c.json({ error: "code_and_state_required" }, 400);
  }

  const pending = await verifyGmailOAuthPending(gmailOAuthJwtSecret(c.env), state);
  if (!pending) return c.json({ error: "invalid_or_expired_state" }, 400);

  const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const redirectUri = `${origin}/v1/workspace/gmail/callback`;
  const exchanged = await exchangeGmailOAuthCode(c.env, code, redirectUri);
  if ("error" in exchanged) return c.json({ error: exchanged.error }, 502);

  const account = await upsertGmailAccount(
    c.env,
    { teamId: pending.teamId, apiKeyHint: pending.apiKeyHint },
    exchanged
  );

  auditRoute(
    c,
    {
      action: "workspace.gmail_connected",
      resourceType: "user_mail_account",
      resourceId: account.id,
      meta: { email: account.email },
    },
    { teamId: pending.teamId, apiKeyHint: pending.apiKeyHint }
  );

  if (pending.returnTo) {
    const url = resolveWorkspaceReturnTo(
      pending.returnTo,
      c.req.url,
      c.env.MAILAGENT_WORKSPACE_ORIGIN,
      c.env.MAILAGENT_PUBLIC_API_ORIGIN
    );
    url.searchParams.set("gmailAccountId", account.id);
    url.searchParams.set("email", account.email);
    return c.redirect(url.toString(), 302);
  }

  return c.json({
    connected: true,
    account,
    hint: "Use gmailAccountId with workspace summarize/draft/reminders or mailagent_gmail_read_thread.",
  });
});

workspaceRoutes.get("/calendar/callback", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const code = c.req.query("code")?.trim();
  const state = c.req.query("state")?.trim();
  const oauthError = c.req.query("error")?.trim();

  if (oauthError) {
    return c.json({ error: oauthError, phase: "calendar_oauth_denied" }, 400);
  }
  if (!code || !state) {
    return c.json({ error: "code_and_state_required" }, 400);
  }

  const pending = await verifyCalendarOAuthPending(calendarOAuthJwtSecret(c.env), state);
  if (!pending) return c.json({ error: "invalid_or_expired_state" }, 400);

  const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const redirectUri = `${origin}/v1/workspace/calendar/callback`;
  const exchanged = await exchangeCalendarOAuthCode(c.env, code, redirectUri, pending.ownerKey);
  if ("error" in exchanged) return c.json({ error: exchanged.error }, 502);

  const account = await upsertCalendarAccount(
    c.env,
    { teamId: pending.teamId, apiKeyHint: pending.apiKeyHint },
    exchanged
  );

  auditRoute(
    c,
    {
      action: "workspace.calendar_connected",
      resourceType: "user_calendar_account",
      resourceId: account.id,
      meta: { email: account.email },
    },
    { teamId: pending.teamId, apiKeyHint: pending.apiKeyHint }
  );

  if (pending.returnTo) {
    const url = resolveWorkspaceReturnTo(
      pending.returnTo,
      c.req.url,
      c.env.MAILAGENT_WORKSPACE_ORIGIN,
      c.env.MAILAGENT_PUBLIC_API_ORIGIN
    );
    url.searchParams.set("calendarAccountId", account.id);
    url.searchParams.set("email", account.email);
    return c.redirect(url.toString(), 302);
  }

  return c.json({
    connected: true,
    account,
    hint: "Use calendarAccountId with /v1/workspace/calendar/availability, /agenda, /suggest-meeting.",
  });
});

workspaceRoutes.use("*", requireApiKey);
workspaceRoutes.use("*", rateLimit);

workspaceRoutes.get("/", (c) => {
  const provider = workspaceProviderInfo(c.env);
  return c.json({
    name: "MailAgent Workspace Agent",
    status: "autonomy_preview",
    safety: {
      defaultMode: "read_only_and_draft_only",
      sendAllowed: "policy_gated",
      calendarWriteAllowed: false,
      redaction: "enabled",
      idempotency: "required_for_send",
    },
    model: {
      provider: provider.provider,
      model: provider.model,
      configured: provider.configured,
      fallbackEnabled: provider.fallbackEnabled,
    },
    endpoints: {
      summarize: "POST /v1/workspace/summarize",
      draftReply: "POST /v1/workspace/draft-reply",
      suggestReminders: "POST /v1/workspace/reminders/suggest",
      createReminder: "POST /v1/workspace/reminders",
      listReminders: "GET /v1/workspace/reminders",
      completeReminder: "PATCH /v1/workspace/reminders/:id/complete",
      logAction: "POST /v1/workspace/actions",
      listActions: "GET /v1/workspace/actions",
      getPolicy: "GET /v1/workspace/policy",
      setPolicy: "PUT /v1/workspace/policy",
      executeReply: "POST /v1/workspace/execute-reply",
      modelStatus: "GET /v1/workspace/models",
      modelProbe: "POST /v1/workspace/models/probe",
      calendarStatus: "GET /v1/workspace/calendar/status",
      calendarConnect: "GET /v1/workspace/calendar/connect",
      calendarAccounts: "GET /v1/workspace/calendar/accounts",
      calendarEvents: "GET /v1/workspace/calendar/events",
      calendarAvailability: "GET /v1/workspace/calendar/availability",
      calendarConflicts: "POST /v1/workspace/calendar/conflicts",
      calendarSuggestMeeting: "POST /v1/workspace/calendar/suggest-meeting",
      calendarAgenda: "GET /v1/workspace/calendar/agenda",
      gmailStatus: "GET /v1/workspace/gmail/status",
      gmailConnect: "GET /v1/workspace/gmail/connect",
      gmailAccounts: "GET /v1/workspace/gmail/accounts",
      gmailThreads: "GET /v1/workspace/gmail/threads",
      gmailReadThread: "GET /v1/workspace/gmail/threads/:threadId",
      gmailTriage: "GET /v1/workspace/gmail/triage",
      gmailDigest: "GET /v1/workspace/gmail/digest",
      gmailSettings: "GET /v1/workspace/gmail/settings",
      gmailSetSettings: "PUT /v1/workspace/gmail/settings",
      gmailExecuteDraft: "POST /v1/workspace/gmail/execute-draft",
      gmailConnectCompose: "GET /v1/workspace/gmail/connect-compose",
      calendarExecuteEvent: "POST /v1/workspace/calendar/execute-event",
      calendarConnectWrite: "GET /v1/workspace/calendar/connect-write",
      rulesStatus: "GET /v1/workspace/rules/status",
      rulesEvaluate: "POST /v1/workspace/rules/evaluate",
      rulesList: "GET /v1/workspace/rules",
      rulesCreate: "POST /v1/workspace/rules",
      rulesDelete: "DELETE /v1/workspace/rules/:id",
      monitorsList: "GET /v1/workspace/monitors",
      monitorsCreate: "POST /v1/workspace/monitors",
      monitorsDelete: "DELETE /v1/workspace/monitors/:id",
      monitorsRun: "POST /v1/workspace/monitors/:id/run",
      monitorsRuns: "GET /v1/workspace/monitors/:id/runs",
      today: "GET /v1/workspace/today",
      todayDecision: "POST /v1/workspace/today/:id/decision",
    },
    roadmap: "https://github.com/navorina-labs/MailAgent/blob/main/docs/WORKSPACE-AGENT-PBR.md",
  });
});

workspaceRoutes.get("/models", (c) => {
  return c.json({ readiness: workspaceProviderInfo(c.env) });
});

workspaceRoutes.post("/models/probe", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;
  return c.json(await probeWorkspaceProviders(c.env));
});

workspaceRoutes.get("/policy", async (c) => {
  const policy = await getWorkspaceAutonomyPolicy(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({
    policy,
    safety: {
      defaultMode: "draft_only",
      replyContextRequired: true,
      ruleFallbackAutoSend: false,
      idempotencyRequired: true,
    },
  });
});

workspaceRoutes.put("/policy", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;
  let body: WorkspaceAutonomyPolicyInput = {};
  try {
    body = await c.req.json<WorkspaceAutonomyPolicyInput>();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const result = await setWorkspaceAutonomyPolicy(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  auditRoute(c, {
    action: "workspace.policy_updated",
    resourceType: "workspace_policy",
    meta: { mode: result.policy.mode },
  });
  return c.json(result.policy);
});

workspaceRoutes.post("/execute-reply", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  let body: WorkspaceExecuteReplyInput = {};
  try {
    body = await c.req.json<WorkspaceExecuteReplyInput>();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body.inboxId || !body.messageId) {
    return c.json({ error: "inbox_id_and_message_id_required" }, 400);
  }
  const inbox = body.inboxId
    ? await getInbox(c.env, body.inboxId, { apiKeyHint: c.get("apiKeyHint") })
    : null;
  const inboxErr = scopeInboxDenied(c, inbox);
  if (inboxErr) return inboxErr;
  const result = await executeWorkspaceReply(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  if (result.sent) {
    auditRoute(c, {
      action: "workspace.reply_sent",
      resourceType: "message",
      resourceId: body.messageId,
      meta: { inboxId: body.inboxId, reminderId: body.reminderId },
    });
  }
  return c.json(result, result.sent ? 201 : 200);
});

workspaceRoutes.post("/summarize", async (c) => {
  let body: WorkspaceSummarizeInput = {};
  try {
    body = await c.req.json<WorkspaceSummarizeInput>();
  } catch {
    body = {};
  }
  const resolved = await resolveWorkspaceMailContext(c.env, {
    ...body,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
  });
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  const result = await summarizeWorkspaceThread(c.env, {
    ...body,
    threadId: body.threadId ?? resolved.context.threadId,
    messages: resolved.context.messages,
  });
  return c.json({ ...result, mailSource: resolved.context.source });
});

workspaceRoutes.post("/draft-reply", async (c) => {
  let body: WorkspaceDraftReplyInput = {};
  try {
    body = await c.req.json<WorkspaceDraftReplyInput>();
  } catch {
    body = {};
  }
  const resolved = await resolveWorkspaceMailContext(c.env, {
    ...body,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
  });
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  const result = await draftWorkspaceReply(c.env, {
    ...body,
    threadId: body.threadId ?? resolved.context.threadId,
    messages: resolved.context.messages,
  });
  return c.json({ ...result, mailSource: resolved.context.source });
});

workspaceRoutes.post("/reminders/suggest", async (c) => {
  let body: WorkspaceReminderInput = {};
  try {
    body = await c.req.json<WorkspaceReminderInput>();
  } catch {
    body = {};
  }
  const resolved = await resolveWorkspaceMailContext(c.env, {
    ...body,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
  });
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  const result = await suggestWorkspaceReminders(c.env, {
    ...body,
    threadId: body.threadId ?? resolved.context.threadId,
    messages: resolved.context.messages,
  });
  return c.json({ ...result, mailSource: resolved.context.source });
});

workspaceRoutes.get("/gmail/status", (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
    return c.json({
      configured: false,
      provider: "gmail",
      phase: "disabled",
      readAllowed: false,
      writeAllowed: false,
      scope: null,
      capabilities: {
        connect: false,
        listThreads: false,
        readThread: false,
        triage: false,
        digest: false,
        classify: false,
        summarize: false,
        draftReply: false,
        send: "disabled",
        draftWrite: false,
      },
      hint: "Google Gmail OAuth is disabled while CASA assessment is not being pursued.",
    });
  }
  const configured = isGmailOAuthConfigured(c.env);
  return c.json({
    configured,
    provider: "gmail",
    phase: configured ? "P1_read_only" : "P1_needs_oauth_secrets",
    readAllowed: configured,
    writeAllowed: false,
    scope: GMAIL_READONLY_SCOPE,
    capabilities: {
      connect: configured,
      listThreads: configured,
      readThread: configured,
      triage: configured,
      digest: configured,
      classify: configured,
      summarize: configured,
      draftReply: configured,
      suggestReminders: configured,
      send: "disabled",
      draftWrite: configured,
    },
    hint: configured
      ? "GET /v1/workspace/gmail/connect to link a mailbox, then pass gmailAccountId + gmailThreadId to summarize/draft/reminders."
      : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or GMAIL_* aliases) on the Worker.",
    docs: "https://github.com/navorina-labs/MailAgent/blob/main/docs/WORKSPACE-AGENT-PBR.md#p1--gmail-read-connector",
  });
});

workspaceRoutes.get("/gmail/connect", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  if (!isGmailOAuthConfigured(c.env)) {
    return c.json({ error: "gmail_oauth_not_configured" }, 503);
  }
  const returnTo = c.req.query("returnTo")?.trim();
  const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const redirectUri = `${origin}/v1/workspace/gmail/callback`;
  const state = await signGmailOAuthPending(gmailOAuthJwtSecret(c.env), {
    ownerKey: workspaceOwnerKey({
      teamId: c.get("teamId"),
      apiKeyHint: c.get("apiKeyHint"),
    }),
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
    returnTo: returnTo || undefined,
  });
  const url = buildGmailAuthorizeUrl(c.env, redirectUri, state);
  if (!url) return c.json({ error: "gmail_oauth_not_configured" }, 503);
  return c.json({ url, redirectUri, scope: GMAIL_READONLY_SCOPE });
});

workspaceRoutes.get("/gmail/accounts", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return c.json({ accounts: [], count: 0, disabled: true });
  const accounts = await listUserMailAccounts(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({ accounts, count: accounts.length });
});

workspaceRoutes.delete("/gmail/accounts/:id", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;
  const revoked = await revokeUserMailAccount(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id")
  );
  if (!revoked) return c.json({ error: "gmail_account_not_found" }, 404);
  auditRoute(c, {
    action: "workspace.gmail_revoked",
    resourceType: "user_mail_account",
    resourceId: c.req.param("id"),
  });
  return c.json({ revoked: true });
});

workspaceRoutes.get("/gmail/threads", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  if (!accountId) return c.json({ error: "account_id_required" }, 400);
  const result = await listGmailThreads(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId,
      q: c.req.query("q") ?? undefined,
      maxResults: Number(c.req.query("maxResults") ?? 20),
      pageToken: c.req.query("pageToken") ?? undefined,
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.get("/gmail/threads/:threadId", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  const threadId = c.req.param("threadId")?.trim();
  if (!accountId || !threadId) {
    return c.json({ error: "account_id_and_thread_id_required" }, 400);
  }
  const result = await readGmailThread(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    { accountId, threadId }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.get("/gmail/triage", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  if (!accountId) return c.json({ error: "account_id_required" }, 400);
  const unreadOnly = c.req.query("unreadOnly") !== "false";
  const result = await triageGmailInbox(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    { accountId, unreadOnly }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.get("/gmail/digest", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  if (!accountId) return c.json({ error: "account_id_required" }, 400);
  const result = await buildGmailDailyDigest(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId,
      sinceHours: Number(c.req.query("sinceHours") ?? 24),
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.get("/gmail/settings", async (c) => {
  const settings = await getWorkspaceGmailSettings(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({
    settings,
    limits: {
      threadLookbackDays: { min: 1, max: 90 },
      maxThreadsPerScan: { min: 5, max: 50 },
      digestMaxThreads: { min: 5, max: 30 },
    },
  });
});

workspaceRoutes.put("/gmail/settings", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;
  let body: WorkspaceGmailSettingsInput = {};
  try {
    body = await c.req.json<WorkspaceGmailSettingsInput>();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  const result = await setWorkspaceGmailSettings(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  auditRoute(c, {
    action: "workspace.gmail_settings_updated",
    resourceType: "workspace_gmail_settings",
    meta: {
      threadLookbackDays: result.settings.threadLookbackDays,
      maxThreadsPerScan: result.settings.maxThreadsPerScan,
      digestMaxThreads: result.settings.digestMaxThreads,
    },
  });
  return c.json({ settings: result.settings });
});

workspaceRoutes.get("/gmail/connect-compose", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  if (!isGmailOAuthConfigured(c.env)) {
    return c.json({ error: "gmail_oauth_not_configured" }, 503);
  }
  const returnTo = c.req.query("returnTo")?.trim();
  const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const redirectUri = `${origin}/v1/workspace/gmail/callback`;
  const state = await signGmailOAuthPending(gmailOAuthJwtSecret(c.env), {
    ownerKey: workspaceOwnerKey({
      teamId: c.get("teamId"),
      apiKeyHint: c.get("apiKeyHint"),
    }),
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
    returnTo: returnTo || undefined,
  });
  const url = buildGmailWriteAuthorizeUrl(c.env, redirectUri, state);
  if (!url) return c.json({ error: "gmail_oauth_not_configured" }, 503);
  return c.json({ url, redirectUri, scope: GMAIL_WRITE_SCOPES, composeScope: GMAIL_COMPOSE_SCOPE });
});

workspaceRoutes.post("/gmail/execute-draft", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  let body: Parameters<typeof executeWorkspaceGmailDraft>[2] = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const result = await executeWorkspaceGmailDraft(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  if (result.executed) {
    auditRoute(c, {
      action: "workspace.gmail_draft_created",
      resourceType: "gmail_draft",
      meta: { draftId: result.draft?.draftId, threadId: result.draft?.threadId },
    });
  }
  return c.json(result, result.executed ? 201 : 200);
});

workspaceRoutes.get("/calendar/status", (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
    return c.json({
      configured: false,
      provider: "google_calendar",
      phase: "disabled",
      readAllowed: false,
      writeAllowed: false,
      scope: null,
      capabilities: {
        connect: false,
        listEvents: false,
        availability: false,
        conflictDetection: false,
        meetingSuggestions: false,
        agendaDigest: false,
        eventWrite: false,
      },
      hint: "Google Calendar OAuth is disabled while CASA assessment is not being pursued.",
    });
  }
  const configured = isCalendarOAuthConfigured(c.env);
  return c.json({
    configured,
    provider: "google_calendar",
    phase: configured ? "P2_read_only" : "P2_needs_oauth_secrets",
    readAllowed: configured,
    writeAllowed: false,
    scope: CALENDAR_READONLY_SCOPE,
    capabilities: {
      connect: configured,
      listEvents: configured,
      availability: configured,
      conflictDetection: configured,
      meetingSuggestions: configured,
      agendaDigest: configured,
      eventWrite: "approval_gated",
    },
    hint: configured
      ? "GET /v1/workspace/calendar/connect to link Google Calendar, then availability/agenda/suggest-meeting."
      : "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (same as Gmail OAuth).",
    docs: "https://github.com/navorina-labs/MailAgent/blob/main/docs/WORKSPACE-AGENT-PBR.md#p2--calendar-read-connector",
  });
});

workspaceRoutes.get("/calendar/connect", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  if (!isCalendarOAuthConfigured(c.env)) {
    return c.json({ error: "calendar_oauth_not_configured" }, 503);
  }
  const returnTo = c.req.query("returnTo")?.trim();
  const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const redirectUri = `${origin}/v1/workspace/calendar/callback`;
  const state = await signCalendarOAuthPending(calendarOAuthJwtSecret(c.env), {
    ownerKey: workspaceOwnerKey({
      teamId: c.get("teamId"),
      apiKeyHint: c.get("apiKeyHint"),
    }),
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
    returnTo: returnTo || undefined,
  });
  const url = buildCalendarAuthorizeUrl(c.env, redirectUri, state);
  if (!url) return c.json({ error: "calendar_oauth_not_configured" }, 503);
  return c.json({ url, redirectUri, scope: CALENDAR_CONNECT_SCOPES });
});

workspaceRoutes.get("/calendar/connect-write", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  if (!isCalendarOAuthConfigured(c.env)) {
    return c.json({ error: "calendar_oauth_not_configured" }, 503);
  }
  const returnTo = c.req.query("returnTo")?.trim();
  const origin = publicOriginFromUrl(c.req.url, c.env.MAILAGENT_PUBLIC_API_ORIGIN);
  const redirectUri = `${origin}/v1/workspace/calendar/callback`;
  const state = await signCalendarOAuthPending(calendarOAuthJwtSecret(c.env), {
    ownerKey: workspaceOwnerKey({
      teamId: c.get("teamId"),
      apiKeyHint: c.get("apiKeyHint"),
    }),
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
    returnTo: returnTo || undefined,
  });
  const url = buildCalendarWriteAuthorizeUrl(c.env, redirectUri, state);
  if (!url) return c.json({ error: "calendar_oauth_not_configured" }, 503);
  return c.json({
    url,
    redirectUri,
    scope: CALENDAR_WRITE_SCOPES,
    eventsScope: CALENDAR_EVENTS_SCOPE,
  });
});

workspaceRoutes.get("/calendar/accounts", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return c.json({ accounts: [], count: 0, disabled: true });
  const accounts = await listUserCalendarAccounts(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({ accounts, count: accounts.length });
});

workspaceRoutes.delete("/calendar/accounts/:id", async (c) => {
  const adminErr = scopeAdminDenied(c);
  if (adminErr) return adminErr;
  const revoked = await revokeUserCalendarAccount(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id")
  );
  if (!revoked) return c.json({ error: "calendar_account_not_found" }, 404);
  auditRoute(c, {
    action: "workspace.calendar_revoked",
    resourceType: "user_calendar_account",
    resourceId: c.req.param("id"),
  });
  return c.json({ revoked: true });
});

workspaceRoutes.get("/calendar/events", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  const timeMin = c.req.query("timeMin")?.trim();
  const timeMax = c.req.query("timeMax")?.trim();
  if (!accountId || !timeMin || !timeMax) {
    return c.json({ error: "account_id_time_min_and_time_max_required" }, 400);
  }
  const result = await listCalendarEventsForAccount(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId,
      timeMin,
      timeMax,
      maxResults: Number(c.req.query("maxResults") ?? 50),
      pageToken: c.req.query("pageToken") ?? undefined,
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.get("/calendar/availability", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  if (!accountId) return c.json({ error: "account_id_required" }, 400);
  const result = await getCalendarAvailability(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId,
      timeZone: c.req.query("timezone") ?? c.req.query("timeZone") ?? undefined,
      days: Number(c.req.query("days") ?? 7),
      durationMinutes: Number(c.req.query("durationMinutes") ?? 30),
      workingHoursStart: Number(c.req.query("workingHoursStart") ?? 9),
      workingHoursEnd: Number(c.req.query("workingHoursEnd") ?? 18),
      maxSlots: Number(c.req.query("maxSlots") ?? 8),
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.post("/calendar/conflicts", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  let body: {
    accountId?: string;
    proposed?: Array<{ start: string; end: string }>;
    bufferMinutes?: number;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  if (!body.accountId?.trim() || !Array.isArray(body.proposed) || !body.proposed.length) {
    return c.json({ error: "account_id_and_proposed_slots_required" }, 400);
  }
  const result = await checkCalendarConflicts(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId: body.accountId,
      proposed: body.proposed,
      bufferMinutes: body.bufferMinutes,
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.post("/calendar/suggest-meeting", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  let body: WorkspaceSummarizeInput & {
    calendarAccountId?: string;
    timeZone?: string;
    timezone?: string;
    durationMinutes?: number;
    days?: number;
    maxSuggestions?: number;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const accountId = body.calendarAccountId?.trim();
  if (!accountId) return c.json({ error: "calendar_account_id_required" }, 400);

  const resolved = await resolveWorkspaceMailContext(c.env, {
    ...body,
    apiKeyHint: c.get("apiKeyHint"),
    teamId: c.get("teamId"),
  });
  const messages =
    resolved.ok && resolved.context.messages.length
      ? resolved.context.messages
      : body.messages;

  const result = await suggestCalendarMeetingFromThread(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId,
      messages,
      timeZone: body.timeZone ?? body.timezone,
      durationMinutes: body.durationMinutes,
      days: body.days,
      maxSuggestions: body.maxSuggestions,
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json({
    ...result,
    mailSource: resolved.ok ? resolved.context.source : body.messages?.length ? "payload" : null,
  });
});

workspaceRoutes.get("/calendar/agenda", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const accountId = c.req.query("accountId")?.trim();
  if (!accountId) return c.json({ error: "account_id_required" }, 400);
  const result = await buildCalendarDailyAgenda(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      accountId,
      date: c.req.query("date") ?? undefined,
      timeZone: c.req.query("timezone") ?? c.req.query("timeZone") ?? undefined,
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

workspaceRoutes.post("/calendar/execute-event", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  let body: Parameters<typeof executeWorkspaceCalendarEvent>[2] = {
    accountId: "",
    summary: "",
    start: "",
    end: "",
  };
  try {
    body = await c.req.json();
  } catch {
    body = { accountId: "", summary: "", start: "", end: "" };
  }
  const result = await executeWorkspaceCalendarEvent(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  if (result.executed) {
    auditRoute(c, {
      action:
        body.eventId?.trim()
          ? "workspace.calendar_event_updated"
          : "workspace.calendar_event_created",
      resourceType: "calendar_event",
      resourceId: result.event?.eventId,
      meta: { summary: body.summary },
    });
  }
  return c.json(result, result.executed ? 201 : 200);
});

workspaceRoutes.get("/rules/status", async (c) => {
  const status = await getWorkspaceRulesStatus(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json(status);
});

workspaceRoutes.get("/rules", async (c) => {
  const rules = await listWorkspaceAutomationRules(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({ rules, count: rules.length });
});

workspaceRoutes.post("/rules", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  let body: WorkspaceAutomationRuleInput = {};
  try {
    body = await c.req.json<WorkspaceAutomationRuleInput>();
  } catch {
    body = {};
  }
  const result = await createWorkspaceAutomationRule(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  auditRoute(c, {
    action: "workspace.automation_rule_created",
    resourceType: "workspace_rule",
    resourceId: result.rule.id,
    meta: { kind: result.rule.kind },
  });
  return c.json(result.rule, 201);
});

workspaceRoutes.delete("/rules/:id", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  const deleted = await deleteWorkspaceAutomationRule(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id")
  );
  if (!deleted) return c.json({ error: "rule_not_found" }, 404);
  return c.json({ deleted: true });
});

workspaceRoutes.post("/rules/evaluate", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  let body: {
    gmailAccountId?: string;
    ruleKinds?: string[];
    unreadOnly?: boolean;
  } = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const gmailAccountId = body.gmailAccountId?.trim();
  if (!gmailAccountId) return c.json({ error: "gmail_account_id_required" }, 400);
  const result = await evaluateWorkspaceRulesForGmail(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      gmailAccountId,
      ruleKinds: body.ruleKinds as WorkspaceRuleKind[] | undefined,
      unreadOnly: body.unreadOnly,
    }
  );
  if ("error" in result) return c.json({ error: result.error }, result.status ?? 400);
  return c.json(result);
});

workspaceRoutes.get("/monitors", async (c) => {
  const monitors = await listWorkspaceMonitors(c.env, {
    teamId: c.get("teamId"),
    apiKeyHint: c.get("apiKeyHint"),
  });
  return c.json({ monitors, count: monitors.length });
});

workspaceRoutes.post("/monitors", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  let body: WorkspaceMonitorInput = {};
  try {
    body = await c.req.json<WorkspaceMonitorInput>();
  } catch {
    body = {};
  }
  const result = await createWorkspaceMonitor(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  auditRoute(c, {
    action: "workspace.monitor_created",
    resourceType: "workspace_monitor",
    resourceId: result.monitor.id,
    meta: { name: result.monitor.name },
  });
  return c.json(result.monitor, 201);
});

workspaceRoutes.delete("/monitors/:id", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  const deleted = await deleteWorkspaceMonitor(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id")
  );
  if (!deleted) return c.json({ error: "monitor_not_found" }, 404);
  return c.json({ deleted: true });
});

workspaceRoutes.post("/monitors/:id/run", async (c) => {
  if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return googleWorkspaceOAuthDisabled(c);
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  const row = await getWorkspaceMonitorRow(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id")
  );
  if (!row) return c.json({ error: "monitor_not_found" }, 404);
  const result = await runWorkspaceMonitorById(c.env, row);
  auditRoute(c, {
    action: "workspace.monitor_run",
    resourceType: "workspace_monitor",
    resourceId: row.id,
    meta: { status: result.status },
  });
  return c.json(result);
});

workspaceRoutes.get("/monitors/:id/runs", async (c) => {
  const monitorId = c.req.param("id");
  const monitor = await getWorkspaceMonitorRow(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    monitorId
  );
  if (!monitor) return c.json({ error: "monitor_not_found" }, 404);
  const runs = await listWorkspaceMonitorRuns(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    monitorId,
    Number(c.req.query("limit") ?? 20)
  );
  return c.json({ monitorId, runs, count: runs.length });
});

workspaceRoutes.get("/today", async (c) => {
  const rawStatus = c.req.query("status")?.trim();
  const allowed = new Set(["open", "all", "new", "approved", "dismissed", "completed", "blocked"]);
  const status = (allowed.has(rawStatus ?? "") ? rawStatus : "open") as
    | WorkspaceCandidateStatus
    | "open"
    | "all";
  const candidates = await listWorkspaceActionCandidates(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    { status, limit: Number(c.req.query("limit") ?? 50) }
  );
  return c.json({ candidates, count: candidates.length, status });
});

workspaceRoutes.post("/today/:id/decision", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;
  let body: { decision?: string } = {};
  try {
    body = await c.req.json<{ decision?: string }>();
  } catch {
    body = {};
  }
  const result = await decideWorkspaceActionCandidate(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id"),
    body.decision ?? ""
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  auditRoute(c, {
    action: "workspace.candidate_decided",
    resourceType: "workspace_action_candidate",
    resourceId: result.candidate.id,
    meta: { decision: result.candidate.status, kind: result.candidate.kind },
  });
  return c.json(result.candidate);
});

workspaceRoutes.get("/reminders", async (c) => {
  const statusRaw = c.req.query("status")?.trim();
  const status =
    statusRaw === "completed" || statusRaw === "all" ? statusRaw : "open";
  const limit = Number(c.req.query("limit") ?? 50);
  const reminders = await listWorkspaceReminders(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    { status, limit }
  );
  return c.json({ reminders, count: reminders.length });
});

workspaceRoutes.post("/reminders", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: WorkspaceReminderCreateInput = {};
  try {
    body = await c.req.json<WorkspaceReminderCreateInput>();
  } catch {
    body = {};
  }

  const result = await createWorkspaceReminder(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.reminder, 201);
});

workspaceRoutes.patch("/reminders/:id/complete", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  const result = await completeWorkspaceReminder(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    c.req.param("id")
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.reminder);
});

workspaceRoutes.get("/actions", async (c) => {
  const actions = await listWorkspaceActions(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    {
      reminderId: c.req.query("reminderId") ?? undefined,
      threadId: c.req.query("threadId") ?? undefined,
      limit: Number(c.req.query("limit") ?? 50),
    }
  );
  return c.json({ actions, count: actions.length });
});

workspaceRoutes.post("/actions", async (c) => {
  const writeErr = scopeWriteDenied(c);
  if (writeErr) return writeErr;

  let body: WorkspaceActionInput = {};
  try {
    body = await c.req.json<WorkspaceActionInput>();
  } catch {
    body = {};
  }

  const result = await logWorkspaceAction(
    c.env,
    { teamId: c.get("teamId"), apiKeyHint: c.get("apiKeyHint") },
    body
  );
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json(result.action, 201);
});
