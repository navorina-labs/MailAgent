/** Discovery endpoint for agents and documentation */

import { Hono } from "hono";
import type { Env } from "../env";
import { workspaceUrl } from "../lib/public-origin";
import { SERVICE_EXPECT_FROM } from "../lib/service-presets";
import { MCP_TOOL_NAMES } from "../mcp/manifest";

export const apiMetaRoutes = new Hono<{ Bindings: Env }>();

apiMetaRoutes.get("/", (c) => {
  return c.json({
    name: "MailAgent",
    version: "0.2.0",
    description:
      "Temporary inboxes for AI agents and QA/E2E (OTP, magic links, CI labels)",
    auth: "Authorization: Bearer <API_KEY>",
    openapi: "/v1/openapi.json",
    agent: {
      hub: "GET /v1/agent",
      verify: "POST /v1/agent/verify",
      recipes: "GET /v1/agent/recipes/:service",
      remoteMcp: "POST /mcp (JSON-RPC, Bearer)",
      docs: workspaceUrl("/docs/agents.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    },
    workspaceAgent: {
      hub: "GET /v1/workspace",
      summarize: "POST /v1/workspace/summarize",
      draftReply: "POST /v1/workspace/draft-reply",
      reminders: "POST /v1/workspace/reminders/suggest",
      actions: "POST /v1/workspace/actions",
      policy: "GET|PUT /v1/workspace/policy",
      executeReply: "POST /v1/workspace/execute-reply",
      models: "GET /v1/workspace/models",
      modelProbe: "POST /v1/workspace/models/probe",
      today: "GET /v1/workspace/today",
      todayDecision: "POST /v1/workspace/today/:id/decision",
      status: "autonomy_preview",
      docs: "https://github.com/navorina-labs/MailAgent/blob/main/docs/WORKSPACE-AGENT-PBR.md",
    },
    endpoints: {
      open: { method: "POST", path: "/v1/inboxes/open", note: "create + wait + extract (+ delete)" },
      listInboxes: { method: "GET", path: "/v1/inboxes?label=", note: "QA filter" },
      createInbox: { method: "POST", path: "/v1/inboxes" },
      getInbox: { method: "GET", path: "/v1/inboxes/:id" },
      messages: { method: "GET", path: "/v1/inboxes/:id/messages" },
      messageRaw: {
        method: "GET",
        path: "/v1/inboxes/:id/messages/:messageId/raw",
        note: "Full .eml from R2 (Accept: application/json for metadata)",
      },
      extract: { method: "GET", path: "/v1/inboxes/:id/extract" },
      events: { method: "GET", path: "/v1/inboxes/:id/events", note: "SSE" },
      wait: { method: "GET", path: "/v1/inboxes/:id/wait" },
      callbackLog: {
        method: "GET",
        path: "/v1/inboxes/:id/callbacks",
        note: "QA webhook delivery log",
      },
      deleteInbox: { method: "DELETE", path: "/v1/inboxes/:id" },
      stats: { method: "GET", path: "/v1/stats", note: "usage counters" },
      me: { method: "GET", path: "/v1/me", note: "plan + limits for key" },
      billingCheckout: {
        method: "POST",
        path: "/v1/billing/checkout",
        note: "Stripe Pro (registered keys)",
      },
      billingPortal: {
        method: "POST",
        path: "/v1/billing/portal",
        note: "Stripe Customer Portal",
      },
      consoleSummary: {
        method: "GET",
        path: "/v1/console/summary",
        note: "Hosted dashboard aggregate",
      },
      consoleThreads: {
        method: "GET",
        path: "/v1/console/threads",
        note: "Recent conversations across scoped inboxes",
      },
      consoleInbox: {
        method: "GET",
        path: "/v1/console/inboxes/:id",
        note: "Inbox detail — messages, threads, callbacks",
      },
      auditLog: { method: "GET", path: "/v1/audit", note: "Team/key audit events" },
      team: { method: "GET", path: "/v1/team", note: "team + API keys" },
      teamCreateKey: { method: "POST", path: "/v1/team/keys", note: "invite" },
      teamRevokeKey: { method: "DELETE", path: "/v1/team/keys/:id" },
      listDomains: { method: "GET", path: "/v1/domains" },
      addDomain: { method: "POST", path: "/v1/domains", note: "Resend DNS records" },
      verifyDomain: { method: "POST", path: "/v1/domains/:id/verify" },
      deleteDomain: { method: "DELETE", path: "/v1/domains/:id" },
      searchMessages: {
        method: "GET",
        path: "/v1/inboxes/:id/search?q=",
        note: "keyword + optional semantic (Workers AI)",
      },
      extractPresets: { method: "GET", path: "/v1/inboxes/:id/extract/presets" },
      extractStructured: {
        method: "POST",
        path: "/v1/inboxes/:id/messages/:messageId/extract",
        note: "preset 2fa|invoice|receipt or custom schema (AI)",
      },
      health: { method: "GET", path: "/health" },
      workspaceSummarize: {
        method: "POST",
        path: "/v1/workspace/summarize",
        note: "Workspace Agent preview: summarize supplied mail thread",
      },
      workspaceDraftReply: {
        method: "POST",
        path: "/v1/workspace/draft-reply",
        note: "Workspace Agent preview: draft only, never sends",
      },
      workspaceReminderSuggest: {
        method: "POST",
        path: "/v1/workspace/reminders/suggest",
        note: "Workspace Agent preview: suggest reminders/follow-ups",
      },
      workspaceReminderCreate: {
        method: "POST",
        path: "/v1/workspace/reminders",
        note: "Workspace Agent preview: persist reminder/follow-up",
      },
      workspaceReminderList: {
        method: "GET",
        path: "/v1/workspace/reminders",
        note: "Workspace Agent preview: list saved reminders/follow-ups",
      },
      workspaceReminderComplete: {
        method: "PATCH",
        path: "/v1/workspace/reminders/:id/complete",
        note: "Workspace Agent preview: complete saved reminder/follow-up",
      },
      workspaceActionLog: {
        method: "POST",
        path: "/v1/workspace/actions",
        note: "Workspace Agent preview: log draft/wait/completed/blocked actions",
      },
      workspaceActionList: {
        method: "GET",
        path: "/v1/workspace/actions",
        note: "Workspace Agent preview: list logged actions by reminderId/threadId",
      },
      workspacePolicy: {
        method: "GET|PUT",
        path: "/v1/workspace/policy",
        note: "Admin policy: draft_only, auto_send_safe, or full_auto",
      },
      workspaceExecuteReply: {
        method: "POST",
        path: "/v1/workspace/execute-reply",
        note: "Policy-gated idempotent reply from a stored inbound message",
      },
      workspaceModels: {
        method: "GET",
        path: "/v1/workspace/models",
        note: "DeepSeek/Qwen readiness and fallback order without secrets",
      },
      workspaceModelProbe: {
        method: "POST",
        path: "/v1/workspace/models/probe",
        note: "Admin-only live model probe",
      },
    },
    services: Object.keys(SERVICE_EXPECT_FROM),
    mcpTools: MCP_TOOL_NAMES,
    qa: {
      label: "CI run id on create/open",
      subjectContains: "filter wait/open by subject",
      callbackUrl: "HTTPS POST on message.received",
      docs: workspaceUrl("/docs/integrate.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
      qaDocs: workspaceUrl("/docs/qa.html", c.env.MAILAGENT_WORKSPACE_ORIGIN),
    },
  });
});
