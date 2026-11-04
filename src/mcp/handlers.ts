/** Execute MCP tools on Worker (no HTTP loopback) */
import type { Env } from "../env";
import type { ApiKeyScope } from "../lib/key-scope";
import type { PlanId } from "../lib/plans";
import { publicApiOrigin } from "../lib/public-origin";
import {
  assertInboxAccessible,
  assertLabelForCreate,
  assertWriteAllowed,
  effectiveLabelPrefix,
  isRestrictedScope,
} from "../lib/key-scope";
import { parseCallbackUrl } from "../lib/callback-url";
import { resolveExpectFrom, resolveTtlMinutes } from "../lib/service-presets";
import { resolveAgentLabel } from "../lib/agent-recipes";
import { suggestPreset, type PresetAdviceInput } from "../lib/preset-advisor";
import {
  buildAgentAutopilotPlan,
  type AgentAutopilotInput,
} from "../lib/agent-autopilot";
import {
  nextAgentRun,
  reportAgentRun,
  startAgentRun,
  type AgentRunNextInput,
  type AgentRunReportInput,
  type AgentRunStartInput,
} from "../services/agent-run-workflow";
import { issueAgentAccess, type AgentAccessInput } from "../services/agent-access";
import { workspaceProviderInfo } from "../services/llm-provider";
import { runAgentVerify } from "../services/agent-verify";
import {
  getAgentRunSession,
  patchAgentRunSession,
  recordInboxRunSession,
  sessionOwnerKey,
} from "../services/agent-run-session";
import { primaryLink } from "../services/extract";
import {
  buildVerificationMetadata,
  formatMessageVerification,
} from "../services/message-verify";
import {
  createInbox,
  deleteInbox,
  deleteInboxesByLabelPrefix,
  getInbox,
  getMessage,
  isCreateInboxError,
  listInboxes,
  listMessages,
} from "../services/inbox";
import {
  createDomain,
  listDomains,
  verifyDomain,
} from "../services/domains";
import { loadRawMessagePayload } from "../services/message-raw";
import {
  formatAttachment,
  fetchAttachmentDownloadMeta,
  getAttachment,
  countAttachmentsForMessage,
  listAttachments,
} from "../services/message-attachments";
import { buildInboxDiagnose } from "../services/inbox-diagnose";
import { simulateInboundMessage } from "../services/simulate-inbound";
import { validateRunId } from "../lib/validate-run-id";
import { listThreadMessages, listThreads, sendFromInbox } from "../services/outbound-mail";
import { searchInboxMessages, type SearchMode } from "../services/message-search";
import {
  extractStructuredFromMessage,
  type ExtractPreset,
} from "../services/structured-extract";
import { buildWaitTimeoutDebug, waitForMessage, type WaitProgressEvent } from "../services/wait";
import { checkEmailAddress } from "../services/email-check";
import {
  draftWorkspaceReply,
  suggestWorkspaceReminders,
  summarizeWorkspaceThread,
  type WorkspaceDraftReplyInput,
  type WorkspaceReminderInput,
  type WorkspaceSummarizeInput,
} from "../services/workspace-agent";
import { resolveWorkspaceMailContext } from "../services/workspace-mail-context";
import {
  buildGmailAuthorizeUrl,
  gmailOAuthJwtSecret,
  isGmailOAuthConfigured,
  listUserMailAccounts,
  GMAIL_READONLY_SCOPE,
} from "../services/user-mail-accounts";
import { signGmailOAuthPending } from "../lib/gmail-oauth-jwt";
import { listGmailThreads, readGmailThread } from "../services/gmail-read";
import { buildGmailDailyDigest, triageGmailInbox } from "../services/gmail-triage";
import {
  getWorkspaceGmailSettings,
  setWorkspaceGmailSettings,
  type WorkspaceGmailSettingsInput,
} from "../services/workspace-gmail-settings";
import {
  buildCalendarAuthorizeUrl,
  CALENDAR_READONLY_SCOPE,
  CALENDAR_CONNECT_SCOPES,
  calendarOAuthJwtSecret,
  isCalendarOAuthConfigured,
  listUserCalendarAccounts,
} from "../services/user-calendar-accounts";
import { signCalendarOAuthPending } from "../lib/gmail-oauth-jwt";
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
import { getWorkspaceRulesStatus } from "../services/workspace-automation-rules";
import {
  createWorkspaceMonitor,
  deleteWorkspaceMonitor,
  getWorkspaceMonitorRow,
  listWorkspaceMonitorRuns,
  listWorkspaceMonitors,
  type WorkspaceMonitorInput,
} from "../services/workspace-monitors";
import {
  evaluateWorkspaceRulesForGmail,
  runWorkspaceMonitorById,
} from "../services/workspace-monitor-runner";
import type { WorkspaceRuleKind } from "../services/workspace-rule-engine";
import { workspaceOwnerKey } from "../services/workspace-reminders";
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
import type { McpProgressParams, McpToolContext } from "../mcp/progress";

export type McpAuth = {
  apiKeyHint: string;
  teamId: string | null;
  plan: PlanId;
  scope: ApiKeyScope;
};

function scopeWriteError(scope: ApiKeyScope) {
  const check = assertWriteAllowed(scope);
  return check.ok ? null : { error: check.error };
}

function scopeAdminError(scope: ApiKeyScope) {
  return isRestrictedScope(scope)
    ? { error: "scope_admin_required", hint: "Use an unrestricted team key" }
    : null;
}

function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

const GOOGLE_WORKSPACE_OAUTH_DISABLED = true;

function googleWorkspaceOAuthDisabledResult() {
  return {
    error: "google_workspace_oauth_disabled",
    hint: "Google Gmail/Calendar OAuth is disabled while MailAgent runs without sensitive or restricted Google scopes.",
  };
}

function parseLinks(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

function bindWaitProgress(ctx?: McpToolContext) {
  if (!ctx?.onProgress) return undefined;
  return (e: WaitProgressEvent) => {
    const params: McpProgressParams = {
      progressToken: e.inboxId,
      progress: e.elapsedSec,
      total: e.timeoutSec,
      message: e.message,
      status: e.status,
      data: {
        inboxId: e.inboxId,
        messageCount: e.messageCount,
        percent: e.progress,
      },
    };
    ctx.onProgress!(params);
  };
}

async function workspaceThreadArgs(
  env: Env,
  auth: McpAuth,
  args: Record<string, unknown>
) {
  const resolved = await resolveWorkspaceMailContext(env, {
    inboxId: args.inboxId as string | undefined,
    threadId: args.threadId as string | undefined,
    messageId: args.messageId as string | undefined,
    messages: args.messages as WorkspaceSummarizeInput["messages"],
    gmailAccountId: args.gmailAccountId as string | undefined,
    gmailThreadId: args.gmailThreadId as string | undefined,
    gmailQuery: args.gmailQuery as string | undefined,
    apiKeyHint: auth.apiKeyHint,
    teamId: auth.teamId,
  });
  if (!resolved.ok) return { error: resolved.error };
  return {
    ...(args as WorkspaceSummarizeInput),
    threadId: (args.threadId as string | undefined) ?? resolved.context.threadId,
    messages: resolved.context.messages,
    mailSource: resolved.context.source,
    gmailAccountId: resolved.context.gmailAccountId,
  };
}

export async function executeMcpTool(
  env: Env,
  auth: McpAuth,
  name: string,
  args: Record<string, unknown>,
  ctx?: McpToolContext
) {
  switch (name) {
    case "mailagent_issue_access": {
      const result = await issueAgentAccess(
        env,
        {
          teamId: auth.teamId,
          plan: auth.plan,
          scope: auth.scope,
        },
        args as AgentAccessInput
      );
      return textResult(result, !result.ok);
    }

    case "mailagent_plan_next": {
      const input = args as AgentAutopilotInput;
      const status = input.status?.trim().toLowerCase();
      const shouldDiagnose =
        Boolean(input.inboxId) && (status === "timeout" || status === "failed");
      if (shouldDiagnose) {
        const inbox = await getInbox(env, input.inboxId!, {
          apiKeyHint: auth.apiKeyHint,
        });
        if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
          return textResult({ error: "inbox_not_found" }, true);
        }
        const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
        const diagnose = await buildInboxDiagnose(env, input.inboxId!, {
          subjectContains: input.subjectContains,
          messageIndex: input.messageIndex,
          apiBaseUrl: apiBase,
          apiKeyHint: auth.apiKeyHint,
        });
        return textResult(buildAgentAutopilotPlan(input, diagnose));
      }
      return textResult(buildAgentAutopilotPlan(input));
    }

    case "mailagent_start_run": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      try {
        const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
        const result = await startAgentRun(
          env,
          {
            ownerKey: sessionOwnerKey(auth.teamId, auth.apiKeyHint),
            teamId: auth.teamId,
            apiKeyHint: auth.apiKeyHint,
            apiBaseUrl: apiBase,
          },
          args as AgentRunStartInput
        );
        return textResult(result, !result.ok);
      } catch (e) {
        if (e instanceof Error && e.message === "invalid_run_id") {
          return textResult({ error: "invalid_run_id" }, true);
        }
        throw e;
      }
    }

    case "mailagent_next_run": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      try {
        const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
        const result = await nextAgentRun(
          env,
          {
            ownerKey: sessionOwnerKey(auth.teamId, auth.apiKeyHint),
            teamId: auth.teamId,
            apiKeyHint: auth.apiKeyHint,
            apiBaseUrl: apiBase,
          },
          args.runId as string,
          args as AgentRunNextInput
        );
        return textResult(result, !result.ok);
      } catch (e) {
        if (e instanceof Error && e.message === "invalid_run_id") {
          return textResult({ error: "invalid_run_id" }, true);
        }
        throw e;
      }
    }

    case "mailagent_report_run": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      try {
        const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
        const result = await reportAgentRun(
          env,
          {
            ownerKey: sessionOwnerKey(auth.teamId, auth.apiKeyHint),
            teamId: auth.teamId,
            apiKeyHint: auth.apiKeyHint,
            apiBaseUrl: apiBase,
          },
          args.runId as string,
          args as AgentRunReportInput
        );
        return textResult(result, !result.ok);
      } catch (e) {
        if (e instanceof Error && e.message === "invalid_run_id") {
          return textResult({ error: "invalid_run_id" }, true);
        }
        throw e;
      }
    }

    case "mailagent_suggest_preset": {
      return textResult(suggestPreset(args as PresetAdviceInput));
    }

    case "mailagent_workspace_summarize": {
      const input = await workspaceThreadArgs(env, auth, args);
      if ("error" in input) return textResult({ error: input.error }, true);
      return textResult(await summarizeWorkspaceThread(env, input));
    }

    case "mailagent_workspace_draft_reply": {
      const input = await workspaceThreadArgs(env, auth, args);
      if ("error" in input) return textResult({ error: input.error }, true);
      return textResult(await draftWorkspaceReply(env, input as WorkspaceDraftReplyInput));
    }

    case "mailagent_workspace_suggest_reminders": {
      const input = await workspaceThreadArgs(env, auth, args);
      if ("error" in input) return textResult({ error: input.error }, true);
      return textResult(await suggestWorkspaceReminders(env, input as WorkspaceReminderInput));
    }

    case "mailagent_workspace_create_reminder": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const result = await createWorkspaceReminder(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as WorkspaceReminderCreateInput
      );
      return textResult(result.ok ? result.reminder : { error: result.error }, !result.ok);
    }

    case "mailagent_workspace_list_reminders": {
      const reminders = await listWorkspaceReminders(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          status:
            args.status === "completed" || args.status === "all"
              ? args.status
              : "open",
          limit: Number(args.limit ?? 50),
        }
      );
      return textResult({ reminders, count: reminders.length });
    }

    case "mailagent_workspace_complete_reminder": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const result = await completeWorkspaceReminder(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args.id as string
      );
      return textResult(result.ok ? result.reminder : { error: result.error }, !result.ok);
    }

    case "mailagent_workspace_log_action": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const result = await logWorkspaceAction(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as WorkspaceActionInput
      );
      return textResult(result.ok ? result.action : { error: result.error }, !result.ok);
    }

    case "mailagent_workspace_list_actions": {
      const actions = await listWorkspaceActions(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          reminderId: args.reminderId as string | undefined,
          threadId: args.threadId as string | undefined,
          limit: Number(args.limit ?? 50),
        }
      );
      return textResult({ actions, count: actions.length });
    }

    case "mailagent_workspace_get_policy": {
      const policy = await getWorkspaceAutonomyPolicy(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult({
        policy,
        safety: {
          defaultMode: "draft_only",
          replyContextRequired: true,
          ruleFallbackAutoSend: false,
          idempotencyRequired: true,
        },
      });
    }

    case "mailagent_workspace_model_status": {
      return textResult({ readiness: workspaceProviderInfo(env) });
    }

    case "mailagent_workspace_set_policy": {
      const adminErr = scopeAdminError(auth.scope);
      if (adminErr) return textResult(adminErr, true);
      const result = await setWorkspaceAutonomyPolicy(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as WorkspaceAutonomyPolicyInput
      );
      return textResult(result.ok ? result.policy : { error: result.error }, !result.ok);
    }

    case "mailagent_workspace_execute_reply": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const inbox = await getInbox(env, args.inboxId as string, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const result = await executeWorkspaceReply(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as WorkspaceExecuteReplyInput
      );
      return textResult(result.ok ? result : { error: result.error }, !result.ok);
    }

    case "mailagent_gmail_status": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult({
          configured: false,
          provider: "gmail",
          readAllowed: false,
          writeAllowed: false,
          scope: null,
          disabled: true,
          hint: googleWorkspaceOAuthDisabledResult().hint,
        });
      }
      const configured = isGmailOAuthConfigured(env);
      return textResult({
        configured,
        provider: "gmail",
        readAllowed: configured,
        writeAllowed: false,
        scope: GMAIL_READONLY_SCOPE,
      });
    }

    case "mailagent_gmail_connect": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      if (!isGmailOAuthConfigured(env)) {
        return textResult({ error: "gmail_oauth_not_configured" }, true);
      }
      const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
      const redirectUri = `${apiBase}/v1/workspace/gmail/callback`;
      const state = await signGmailOAuthPending(gmailOAuthJwtSecret(env), {
        ownerKey: workspaceOwnerKey({
          teamId: auth.teamId,
          apiKeyHint: auth.apiKeyHint,
        }),
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      const url = buildGmailAuthorizeUrl(env, redirectUri, state);
      if (!url) return textResult({ error: "gmail_oauth_not_configured" }, true);
      return textResult({
        url,
        redirectUri,
        scope: GMAIL_READONLY_SCOPE,
        hint: "Google Gmail OAuth is disabled while MailAgent runs without sensitive or restricted Google scopes.",
      });
    }

    case "mailagent_gmail_list_accounts": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return textResult({ accounts: [], count: 0, disabled: true });
      const accounts = await listUserMailAccounts(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult({ accounts, count: accounts.length });
    }

    case "mailagent_gmail_list_threads": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      if (!accountId?.trim()) return textResult({ error: "account_id_required" }, true);
      const result = await listGmailThreads(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          q: args.q as string | undefined,
          maxResults: Number(args.maxResults ?? 20),
          pageToken: args.pageToken as string | undefined,
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_gmail_read_thread": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      const threadId = args.threadId as string | undefined;
      if (!accountId?.trim() || !threadId?.trim()) {
        return textResult({ error: "account_id_and_thread_id_required" }, true);
      }
      const result = await readGmailThread(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        { accountId, threadId }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_gmail_triage": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      if (!accountId?.trim()) return textResult({ error: "account_id_required" }, true);
      const result = await triageGmailInbox(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          unreadOnly: args.unreadOnly !== false,
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_gmail_digest": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      if (!accountId?.trim()) return textResult({ error: "account_id_required" }, true);
      const result = await buildGmailDailyDigest(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          sinceHours: Number(args.sinceHours ?? 24),
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_gmail_get_settings": {
      const settings = await getWorkspaceGmailSettings(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult({ settings });
    }

    case "mailagent_gmail_set_settings": {
      const adminErr = scopeAdminError(auth.scope);
      if (adminErr) return textResult(adminErr, true);
      const result = await setWorkspaceGmailSettings(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as WorkspaceGmailSettingsInput
      );
      return textResult(result.ok ? { settings: result.settings } : { error: result.error }, !result.ok);
    }

    case "mailagent_calendar_status": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult({
          configured: false,
          provider: "google_calendar",
          readAllowed: false,
          writeAllowed: false,
          scope: null,
          disabled: true,
          hint: googleWorkspaceOAuthDisabledResult().hint,
        });
      }
      const configured = isCalendarOAuthConfigured(env);
      return textResult({
        configured,
        provider: "google_calendar",
        readAllowed: configured,
        writeAllowed: false,
        scope: CALENDAR_READONLY_SCOPE,
      });
    }

    case "mailagent_calendar_connect": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      if (!isCalendarOAuthConfigured(env)) {
        return textResult({ error: "calendar_oauth_not_configured" }, true);
      }
      const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
      const redirectUri = `${apiBase}/v1/workspace/calendar/callback`;
      const state = await signCalendarOAuthPending(calendarOAuthJwtSecret(env), {
        ownerKey: workspaceOwnerKey({
          teamId: auth.teamId,
          apiKeyHint: auth.apiKeyHint,
        }),
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      const url = buildCalendarAuthorizeUrl(env, redirectUri, state);
      if (!url) return textResult({ error: "calendar_oauth_not_configured" }, true);
      return textResult({
        url,
        redirectUri,
        scope: CALENDAR_CONNECT_SCOPES,
        hint: "Open url in browser, then mailagent_calendar_list_accounts.",
      });
    }

    case "mailagent_calendar_list_accounts": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) return textResult({ accounts: [], count: 0, disabled: true });
      const accounts = await listUserCalendarAccounts(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult({ accounts, count: accounts.length });
    }

    case "mailagent_calendar_list_events": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      const timeMin = args.timeMin as string | undefined;
      const timeMax = args.timeMax as string | undefined;
      if (!accountId?.trim() || !timeMin?.trim() || !timeMax?.trim()) {
        return textResult({ error: "account_id_time_min_and_time_max_required" }, true);
      }
      const result = await listCalendarEventsForAccount(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          timeMin,
          timeMax,
          maxResults: Number(args.maxResults ?? 50),
          pageToken: args.pageToken as string | undefined,
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_calendar_availability": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      if (!accountId?.trim()) return textResult({ error: "account_id_required" }, true);
      const result = await getCalendarAvailability(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          timeZone: (args.timeZone ?? args.timezone) as string | undefined,
          days: Number(args.days ?? 7),
          durationMinutes: Number(args.durationMinutes ?? 30),
          workingHoursStart: Number(args.workingHoursStart ?? 9),
          workingHoursEnd: Number(args.workingHoursEnd ?? 18),
          maxSlots: Number(args.maxSlots ?? 8),
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_calendar_check_conflicts": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      const proposed = args.proposed as Array<{ start: string; end: string }> | undefined;
      if (!accountId?.trim() || !Array.isArray(proposed) || !proposed.length) {
        return textResult({ error: "account_id_and_proposed_slots_required" }, true);
      }
      const result = await checkCalendarConflicts(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          proposed,
          bufferMinutes: Number(args.bufferMinutes ?? 0),
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_calendar_suggest_meeting": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = (args.calendarAccountId ?? args.accountId) as string | undefined;
      if (!accountId?.trim()) {
        return textResult({ error: "calendar_account_id_required" }, true);
      }
      const resolved = await resolveWorkspaceMailContext(env, {
        inboxId: args.inboxId as string | undefined,
        threadId: args.threadId as string | undefined,
        messageId: args.messageId as string | undefined,
        messages: args.messages as WorkspaceSummarizeInput["messages"],
        gmailAccountId: args.gmailAccountId as string | undefined,
        gmailThreadId: args.gmailThreadId as string | undefined,
        gmailQuery: args.gmailQuery as string | undefined,
        apiKeyHint: auth.apiKeyHint,
        teamId: auth.teamId,
      });
      const messages =
        resolved.ok && resolved.context.messages.length
          ? resolved.context.messages
          : (args.messages as WorkspaceSummarizeInput["messages"]);
      const result = await suggestCalendarMeetingFromThread(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          messages,
          timeZone: (args.timeZone ?? args.timezone) as string | undefined,
          durationMinutes: Number(args.durationMinutes ?? undefined),
          days: Number(args.days ?? 7),
          maxSuggestions: Number(args.maxSuggestions ?? 5),
        }
      );
      return textResult(
        {
          ...result,
          mailSource: resolved.ok ? resolved.context.source : messages?.length ? "payload" : null,
        },
        "error" in result
      );
    }

    case "mailagent_calendar_agenda": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const accountId = args.accountId as string | undefined;
      if (!accountId?.trim()) return textResult({ error: "account_id_required" }, true);
      const result = await buildCalendarDailyAgenda(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          accountId,
          date: args.date as string | undefined,
          timeZone: (args.timeZone ?? args.timezone) as string | undefined,
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_workspace_execute_gmail_draft": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const result = await executeWorkspaceGmailDraft(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as Parameters<typeof executeWorkspaceGmailDraft>[2]
      );
      return textResult(result.ok ? result : { error: result.error }, !result.ok);
    }

    case "mailagent_workspace_execute_calendar_event": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const result = await executeWorkspaceCalendarEvent(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as Parameters<typeof executeWorkspaceCalendarEvent>[2]
      );
      return textResult(result.ok ? result : { error: result.error }, !result.ok);
    }

    case "mailagent_workspace_rules_status": {
      const status = await getWorkspaceRulesStatus(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult(status);
    }

    case "mailagent_workspace_rules_evaluate": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const gmailAccountId = args.gmailAccountId as string | undefined;
      if (!gmailAccountId?.trim()) {
        return textResult({ error: "gmail_account_id_required" }, true);
      }
      const result = await evaluateWorkspaceRulesForGmail(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        {
          gmailAccountId,
          ruleKinds: args.ruleKinds as WorkspaceRuleKind[] | undefined,
          unreadOnly: args.unreadOnly as boolean | undefined,
        }
      );
      return textResult(result, "error" in result);
    }

    case "mailagent_workspace_list_monitors": {
      const monitors = await listWorkspaceMonitors(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult({ monitors, count: monitors.length });
    }

    case "mailagent_workspace_create_monitor": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const result = await createWorkspaceMonitor(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        args as WorkspaceMonitorInput
      );
      return textResult(
        result.ok ? result.monitor : { error: result.error },
        !result.ok
      );
    }

    case "mailagent_workspace_delete_monitor": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const monitorId = args.monitorId as string | undefined;
      if (!monitorId?.trim()) return textResult({ error: "monitor_id_required" }, true);
      const deleted = await deleteWorkspaceMonitor(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        monitorId
      );
      if (!deleted) return textResult({ error: "monitor_not_found" }, true);
      return textResult({ deleted: true });
    }

    case "mailagent_workspace_run_monitor": {
      if (GOOGLE_WORKSPACE_OAUTH_DISABLED) {
        return textResult(googleWorkspaceOAuthDisabledResult(), true);
      }
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const monitorId = args.monitorId as string | undefined;
      if (!monitorId?.trim()) return textResult({ error: "monitor_id_required" }, true);
      const row = await getWorkspaceMonitorRow(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        monitorId
      );
      if (!row) return textResult({ error: "monitor_not_found" }, true);
      const result = await runWorkspaceMonitorById(env, row);
      return textResult(result);
    }

    case "mailagent_workspace_list_monitor_runs": {
      const monitorId = args.monitorId as string | undefined;
      if (!monitorId?.trim()) return textResult({ error: "monitor_id_required" }, true);
      const row = await getWorkspaceMonitorRow(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        monitorId
      );
      if (!row) return textResult({ error: "monitor_not_found" }, true);
      const runs = await listWorkspaceMonitorRuns(
        env,
        { teamId: auth.teamId, apiKeyHint: auth.apiKeyHint },
        monitorId,
        Number(args.limit ?? 20)
      );
      return textResult({ monitorId, runs, count: runs.length });
    }

    case "mailagent_verify_signup": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const agentLabel = resolveAgentLabel({
        label: args.label as string | undefined,
        runId: args.runId as string | undefined,
      });
      const labelCheck = assertLabelForCreate(auth.scope, agentLabel);
      if (!labelCheck.ok) {
        return textResult({ error: labelCheck.error, hint: labelCheck.hint }, true);
      }
      const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
      const result = await runAgentVerify(env, {
        inboxId: args.inboxId as string | undefined,
        service: args.service as string | undefined,
        expectFrom: args.expectFrom as string | string[] | undefined,
        flow: args.flow as string | undefined,
        label: labelCheck.label ?? undefined,
        subjectContains: args.subjectContains as string | undefined,
        messageIndex: args.messageIndex as number | undefined,
        timeoutSeconds: args.timeoutSeconds as number | undefined,
        ttlMinutes: args.ttlMinutes as number | undefined,
        deleteAfter: args.deleteAfter as boolean | undefined,
        deleteAfterSuccess: args.deleteAfterSuccess as boolean | undefined,
        deleteAfterMinutes: args.deleteAfterMinutes as number | undefined,
        keepOnFailure: args.keepOnFailure as boolean | undefined,
        runId: args.runId as string | undefined,
        apiKeyHint: auth.apiKeyHint,
        teamId: auth.teamId,
        onProgress: bindWaitProgress(ctx),
        apiBaseUrl: apiBase,
      });
      if ("error" in result) {
        return textResult(result, true);
      }
      if (result.status === "timeout") {
        return textResult(result, true);
      }
      return textResult(result);
    }

    case "mailagent_create_inbox": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const callbackUrl = parseCallbackUrl(args.callbackUrl as string | undefined);
      if (args.callbackUrl && !callbackUrl) {
        return textResult({ error: "invalid_callback_url" }, true);
      }
      const agentLabel = resolveAgentLabel({
        label: args.label as string | undefined,
        runId: args.runId as string | undefined,
      });
      const labelCheck = assertLabelForCreate(auth.scope, agentLabel);
      if (!labelCheck.ok) {
        return textResult({ error: labelCheck.error, hint: labelCheck.hint }, true);
      }
      const expectFrom = resolveExpectFrom(
        args.service as string | undefined,
        args.expectFrom as string | string[] | undefined
      );
      const inbox = await createInbox(env, {
        ttlMinutes: resolveTtlMinutes(
          args.service as string | undefined,
          (args.deleteAfterMinutes as number | undefined) ??
            (args.ttlMinutes as number | undefined)
        ),
        expectFrom,
        label: labelCheck.label ?? undefined,
        callbackUrl,
        apiKeyHint: auth.apiKeyHint,
        teamId: auth.teamId,
        username: args.username as string | undefined,
        domainId: args.domainId as string | undefined,
      });
      if (isCreateInboxError(inbox)) {
        return textResult({ error: inbox.error }, true);
      }
      await recordInboxRunSession(
        env,
        args.runId as string | undefined,
        sessionOwnerKey(auth.teamId, auth.apiKeyHint),
        { id: inbox.id, address: inbox.address }
      );
      return textResult({
        id: inbox.id,
        address: inbox.address,
        expiresAt: inbox.expires_at,
        allowedSenders: inbox.allowed_senders,
        hint: "Submit address on signup, then mailagent_verify_signup with inboxId.",
      });
    }

    case "mailagent_wait_and_extract": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr && !args.inboxId) return textResult(writeErr, true);
      if (!args.inboxId) {
        const agentLabel = resolveAgentLabel({
          runId: args.runId as string | undefined,
        });
        const labelCheck = assertLabelForCreate(auth.scope, agentLabel);
        if (!labelCheck.ok) {
          return textResult({ error: labelCheck.error, hint: labelCheck.hint }, true);
        }
        const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
        const v = await runAgentVerify(env, {
          service: args.service as string | undefined,
          expectFrom: args.expectFrom as string | string[] | undefined,
          label: labelCheck.label ?? undefined,
          subjectContains: args.subjectContains as string | undefined,
          messageIndex: args.messageIndex as number | undefined,
          timeoutSeconds: args.timeoutSeconds as number | undefined,
          deleteAfter: args.deleteAfter as boolean | undefined,
          deleteAfterSuccess: args.deleteAfterSuccess as boolean | undefined,
          deleteAfterMinutes: args.deleteAfterMinutes as number | undefined,
          keepOnFailure: args.keepOnFailure as boolean | undefined,
          runId: args.runId as string | undefined,
          apiKeyHint: auth.apiKeyHint,
          teamId: auth.teamId,
          onProgress: bindWaitProgress(ctx),
          apiBaseUrl: apiBase,
        });
        if (v.status === "timeout" || "error" in v) {
          return textResult(v, true);
        }
        return textResult({
          inboxId: v.email.inboxId,
          address: v.email.address,
          verification: v.verification,
          deleted: v.deleted,
        });
      }

      const inboxId = args.inboxId as string;
      const inboxRow = await getInbox(env, inboxId, { apiKeyHint: auth.apiKeyHint });
      if (!inboxRow || !assertInboxAccessible(auth.scope, inboxRow).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const timeout = Math.min(Number(args.timeoutSeconds ?? 90), 120);
      const message = await waitForMessage(env, inboxId, timeout, {
        subjectContains: args.subjectContains as string | undefined,
        messageIndex: args.messageIndex as number | undefined,
        onProgress: bindWaitProgress(ctx),
      });
      if (!message) {
        const debug = await buildWaitTimeoutDebug(env, inboxId, {
          subjectContains: args.subjectContains as string | undefined,
          messageIndex: args.messageIndex as number | undefined,
        });
        return textResult({ error: "timeout", inboxId, ...debug }, true);
      }
      const verification = formatMessageVerification(message, inboxId);
      let deleted = false;
      const deleteAfterSuccess =
        (args.deleteAfterSuccess as boolean | undefined) ??
        (args.deleteAfter as boolean | undefined) ??
        true;
      if (deleteAfterSuccess) {
        if (scopeWriteError(auth.scope)) {
          return textResult({ error: "scope_read_only" }, true);
        }
        deleted = await deleteInbox(env, inboxId, {
          apiKeyHint: auth.apiKeyHint,
        });
      }
      return textResult({ inboxId, verification, deleted });
    }

    case "mailagent_cleanup_inboxes": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const requestedPrefix =
        typeof args.labelPrefix === "string" && args.labelPrefix.trim()
          ? args.labelPrefix
          : typeof args.runId === "string" && args.runId.trim()
            ? `agent-${args.runId.trim()}`
            : undefined;
      const prefix = effectiveLabelPrefix(auth.scope, requestedPrefix);
      if (!prefix) return textResult({ error: "labelPrefix_required" }, true);
      if (prefix.length < 3) {
        return textResult({ error: "labelPrefix_too_short", minLength: 3 }, true);
      }
      const ids = await deleteInboxesByLabelPrefix(env, prefix, auth.apiKeyHint);
      return textResult({ deleted: ids.length, ids, labelPrefix: prefix });
    }

    case "mailagent_list_inboxes": {
      const label =
        resolveAgentLabel({
          label: args.label as string | undefined,
          runId: args.runId as string | undefined,
        }) ?? (args.label as string | undefined);
      const prefix = effectiveLabelPrefix(auth.scope, args.labelPrefix as string | undefined);
      const rows = await listInboxes(env, {
        label,
        labelPrefix: prefix,
        limit: Number(args.limit ?? 20),
        apiKeyHint: auth.apiKeyHint,
      });
      return textResult({
        inboxes: rows.map((r) => ({
          id: r.id,
          address: r.address,
          label: r.label,
          expiresAt: r.expires_at,
        })),
      });
    }

    case "mailagent_wait_for_message": {
      const inboxId = args.inboxId as string;
      const inboxRow = await getInbox(env, inboxId, { apiKeyHint: auth.apiKeyHint });
      if (!inboxRow || !assertInboxAccessible(auth.scope, inboxRow).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const timeout = Math.min(Number(args.timeoutSeconds ?? 90), 120);
      const message = await waitForMessage(env, inboxId, timeout, {
        subjectContains: args.subjectContains as string | undefined,
        messageIndex: args.messageIndex as number | undefined,
        onProgress: bindWaitProgress(ctx),
      });
      if (!message) {
        const debug = await buildWaitTimeoutDebug(env, inboxId, {
          subjectContains: args.subjectContains as string | undefined,
          messageIndex: args.messageIndex as number | undefined,
        });
        return textResult({ error: "timeout", inboxId, ...debug }, true);
      }
      const links = parseLinks(message.links_json);
      const primary = primaryLink(links);
      return textResult({
        message: {
          id: message.id,
          from: message.from_addr,
          subject: message.subject,
          otp: message.otp,
          links,
          primaryLink: primary,
          ...buildVerificationMetadata(message.otp, links, primary),
          receivedAt: message.received_at,
          hasRaw: Boolean(message.raw_r2_key),
          ...(message.raw_r2_key
            ? { rawUrl: `/v1/inboxes/${inboxId}/messages/${message.id}/raw` }
            : {}),
          attachmentCount: await countAttachmentsForMessage(env, message.id),
        },
      });
    }

    case "mailagent_list_messages": {
      const inboxId = args.inboxId as string;
      const inboxRow = await getInbox(env, inboxId, { apiKeyHint: auth.apiKeyHint });
      if (!inboxRow || !assertInboxAccessible(auth.scope, inboxRow).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const messages = await listMessages(env, inboxId, {
        subjectContains: args.subjectContains as string | undefined,
      });
      return textResult({
        messages: await Promise.all(
          messages.map(async (m) => {
            const links = parseLinks(m.links_json);
            const primary = primaryLink(links);
            const attachmentCount = await countAttachmentsForMessage(env, m.id);
            return {
              id: m.id,
              from: m.from_addr,
              subject: m.subject,
              otp: m.otp,
              links,
              primaryLink: primary,
              ...buildVerificationMetadata(m.otp, links, primary),
              receivedAt: m.received_at,
              hasRaw: Boolean(m.raw_r2_key),
              ...(m.raw_r2_key
                ? { rawUrl: `/v1/inboxes/${inboxId}/messages/${m.id}/raw` }
                : {}),
              attachmentCount,
            };
          })
        ),
      });
    }

    case "mailagent_get_raw_message": {
      const inboxId = args.inboxId as string;
      const messageId = args.messageId as string;
      const inboxRow = await getInbox(env, inboxId, { apiKeyHint: auth.apiKeyHint });
      if (!inboxRow || !assertInboxAccessible(auth.scope, inboxRow).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const payload = await loadRawMessagePayload(env, inboxId, messageId, {
        includeBody: args.includeBody === true,
      });
      if (!payload.ok) {
        return textResult(
          { error: payload.error, hint: payload.hint },
          true
        );
      }
      return textResult(payload);
    }

    case "mailagent_list_attachments": {
      const inboxId = args.inboxId as string;
      const messageId = args.messageId as string;
      const inboxRow = await getInbox(env, inboxId, { apiKeyHint: auth.apiKeyHint });
      if (!inboxRow || !assertInboxAccessible(auth.scope, inboxRow).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const message = await getMessage(env, inboxId, messageId);
      if (!message) return textResult({ error: "message_not_found" }, true);
      const rows = await listAttachments(env, message.id);
      return textResult({
        messageId: message.id,
        attachments: rows.map((r) =>
          formatAttachment(r, inboxId, message.id)
        ),
      });
    }

    case "mailagent_get_attachment": {
      const inboxId = args.inboxId as string;
      const messageId = args.messageId as string;
      const attachmentId = args.attachmentId as string;
      const inboxRow = await getInbox(env, inboxId, { apiKeyHint: auth.apiKeyHint });
      if (!inboxRow || !assertInboxAccessible(auth.scope, inboxRow).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const message = await getMessage(env, inboxId, messageId);
      if (!message) return textResult({ error: "message_not_found" }, true);
      const row = await getAttachment(env, message.id, attachmentId);
      if (!row) return textResult({ error: "attachment_not_found" }, true);
      const meta = await fetchAttachmentDownloadMeta(
        env,
        message.provider_id,
        row
      );
      if ("error" in meta) return textResult({ error: meta.error }, true);
      return textResult({
        ...meta,
        messageId: message.id,
        inboxId,
        downloadPath: `/v1/inboxes/${inboxId}/messages/${messageId}/attachments/${attachmentId}`,
      });
    }

    case "mailagent_extract_verification": {
      const inboxId = args.inboxId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const messages = await listMessages(env, inboxId);
      const latest = messages[0];
      if (!latest) return textResult({ error: "no_messages" }, true);
      return textResult({
        ...formatMessageVerification(latest, inboxId),
        attachmentCount: await countAttachmentsForMessage(env, latest.id),
      });
    }

    case "mailagent_simulate_message": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const inboxId = args.inboxId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const result = await simulateInboundMessage(env, {
        inboxId,
        apiKeyHint: auth.apiKeyHint,
        scenario: args.scenario as string | undefined,
        otp: args.otp as string | undefined,
        from: args.from as string | undefined,
        subject: args.subject as string | undefined,
        fireCallback: args.fireCallback === true,
        attachmentFilename: args.attachmentFilename as string | undefined,
        inReplyToMessageId: args.inReplyToMessageId as string | undefined,
        rfcMessageId: args.rfcMessageId as string | undefined,
        inReplyTo: args.inReplyTo as string | undefined,
        references: args.references as string | undefined,
        headers: args.headers as
          | Record<string, string | string[] | undefined>
          | undefined,
      });
      if (!result) return textResult({ error: "simulate_failed" }, true);
      return textResult(result);
    }

    case "mailagent_send_message": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const inboxId = args.inboxId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const toRaw = args.to;
      const to = Array.isArray(toRaw)
        ? (toRaw as string[])
        : typeof toRaw === "string"
          ? [toRaw]
          : [];
      try {
        const result = await sendFromInbox(env, {
          inboxId,
          apiKeyHint: auth.apiKeyHint,
          teamId: auth.teamId,
          to,
          subject: args.subject as string,
          text: args.text as string | undefined,
          html: args.html as string | undefined,
          inReplyToMessageId: args.inReplyToMessageId as string | undefined,
        });
        if (!result) return textResult({ error: "send_failed" }, true);
        return textResult(result);
      } catch (e) {
        return textResult(
          { error: "send_failed", message: e instanceof Error ? e.message : String(e) },
          true
        );
      }
    }

    case "mailagent_list_threads": {
      const inboxId = args.inboxId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const threadId = args.threadId as string | undefined;
      if (threadId) {
        const messages = await listThreadMessages(env, inboxId, threadId);
        return textResult({ threadId, messages });
      }
      const threads = await listThreads(env, inboxId);
      return textResult({ threads });
    }

    case "mailagent_add_domain": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const name = args.name as string;
      if (!name?.trim()) return textResult({ error: "name_required" }, true);
      const result = await createDomain(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
        plan: auth.plan,
      }, name);
      if (!result.ok) return textResult({ error: result.error, hint: result.hint }, true);
      return textResult(result.domain);
    }

    case "mailagent_list_domains": {
      const domains = await listDomains(env, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
        plan: auth.plan,
      });
      return textResult({ domains });
    }

    case "mailagent_verify_domain": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const domainId = args.domainId as string;
      const result = await verifyDomain(env, domainId, {
        teamId: auth.teamId,
        apiKeyHint: auth.apiKeyHint,
        plan: auth.plan,
      });
      if (!result.ok) return textResult({ error: result.error, hint: result.hint }, true);
      return textResult(result.domain);
    }

    case "mailagent_extract_structured": {
      const inboxId = args.inboxId as string;
      const messageId = args.messageId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const message = await getMessage(env, inboxId, messageId);
      if (!message) return textResult({ error: "message_not_found" }, true);

      const preset = args.preset as ExtractPreset | undefined;
      const schema = args.schema as Record<string, unknown> | undefined;
      const result = await extractStructuredFromMessage(env, message, {
        preset,
        schema,
      });
      if ("error" in result) return textResult({ error: result.error }, true);
      return textResult(result);
    }

    case "mailagent_search_messages": {
      const inboxId = args.inboxId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const q = args.q as string;
      if (!q?.trim()) return textResult({ error: "q_required" }, true);
      const modeRaw = args.mode as string | undefined;
      const mode: SearchMode =
        modeRaw === "keyword" || modeRaw === "semantic" ? modeRaw : "auto";
      const result = await searchInboxMessages(env, inboxId, q, {
        limit: args.limit as number | undefined,
        mode,
      });
      return textResult(result);
    }

    case "mailagent_check_email": {
      const email = args.email as string;
      const result = await checkEmailAddress(env, { email });
      if ("error" in result) {
        return textResult({ error: result.error }, true);
      }
      return textResult(result);
    }

    case "mailagent_diagnose_inbox": {
      const inboxId = args.inboxId as string;
      const inbox = await getInbox(env, inboxId, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const apiBase = ctx?.apiBaseUrl?.replace(/\/$/, "") ?? publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN);
      const diagnose = await buildInboxDiagnose(env, inboxId, {
        subjectContains: args.subjectContains as string | undefined,
        messageIndex: args.messageIndex as number | undefined,
        apiBaseUrl: apiBase,
        apiKeyHint: auth.apiKeyHint,
      });
      if (!diagnose) return textResult({ error: "inbox_not_found" }, true);
      return textResult(diagnose);
    }

    case "mailagent_get_inbox": {
      const inbox = await getInbox(env, args.inboxId as string, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const messages = await listMessages(env, inbox.id);
      return textResult({
        id: inbox.id,
        address: inbox.address,
        expiresAt: inbox.expires_at,
        label: inbox.label,
        messageCount: messages.length,
      });
    }

    case "mailagent_delete_inbox": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const inbox = await getInbox(env, args.inboxId as string, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!inbox || !assertInboxAccessible(auth.scope, inbox).ok) {
        return textResult({ error: "inbox_not_found" }, true);
      }
      const ok = await deleteInbox(env, args.inboxId as string, {
        apiKeyHint: auth.apiKeyHint,
      });
      if (!ok) return textResult({ error: "inbox_not_found" }, true);
      return textResult({ deleted: true });
    }

    case "mailagent_get_run_session": {
      const runId = args.runId as string;
      if (!validateRunId(runId)) {
        return textResult({ error: "invalid_run_id" }, true);
      }
      const owner = sessionOwnerKey(auth.teamId, auth.apiKeyHint);
      const session = await getAgentRunSession(env, runId, owner);
      if (!session) return textResult({ error: "session_not_found" }, true);
      return textResult(session);
    }

    case "mailagent_get_run_timeline": {
      const runId = args.runId as string;
      if (!validateRunId(runId)) {
        return textResult({ error: "invalid_run_id" }, true);
      }
      const owner = sessionOwnerKey(auth.teamId, auth.apiKeyHint);
      const session = await getAgentRunSession(env, runId, owner);
      if (!session) return textResult({ error: "session_not_found" }, true);
      return textResult({
        runId: session.runId,
        timeline: session.timeline,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      });
    }

    case "mailagent_patch_run_session": {
      const writeErr = scopeWriteError(auth.scope);
      if (writeErr) return textResult(writeErr, true);
      const runId = args.runId as string;
      if (!validateRunId(runId)) {
        return textResult({ error: "invalid_run_id" }, true);
      }
      const owner = sessionOwnerKey(auth.teamId, auth.apiKeyHint);
      const result = await patchAgentRunSession(env, runId, owner, {
        merge: args.merge as Record<string, unknown> | undefined,
        replaceState: args.replaceState as Record<string, unknown> | undefined,
        step: args.step as { name: string; data?: Record<string, unknown> } | undefined,
      });
      if (!result.ok) return textResult({ error: result.error }, true);
      return textResult(result.session);
    }

    default:
      return textResult({ error: "unknown_tool", name }, true);
  }
}
