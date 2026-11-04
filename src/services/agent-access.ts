/** Agent access broker: short-lived scoped keys for autonomous QA runs. */
import type { Env } from "../env";
import { generateApiKeyToken } from "../lib/generate-api-key";
import type { ApiKeyScope } from "../lib/key-scope";
import { isRestrictedScope } from "../lib/key-scope";
import { PLAN_LIMITS, type PlanId } from "../lib/plans";
import { validateRunId } from "../lib/validate-run-id";
import { addTeamKey, countTeamKeys } from "./api-key-store";
import { publicApiOrigin } from "../lib/public-origin";

export type AgentAccessInput = {
  purpose?: string;
  runId?: string;
  labelPrefix?: string;
  ttlMinutes?: number;
  readOnly?: boolean;
  service?: string;
  allowSimulate?: boolean;
};

export type AgentAccessAuth = {
  teamId: string | null;
  plan: PlanId;
  scope: ApiKeyScope;
};

const DEFAULT_TTL_MINUTES = 240;
const MAX_TTL_MINUTES = 24 * 60;

function cleanPurpose(value?: string): string {
  return value?.trim().slice(0, 64) || "agent-run";
}

function cleanPrefix(value?: string): string | null {
  const raw = value?.trim().slice(0, 64);
  if (!raw) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(raw)) return null;
  return raw.endsWith("-") || raw.endsWith(":") ? raw : `${raw}-`;
}

function prefixFromInput(input: AgentAccessInput): string | null {
  const explicit = cleanPrefix(input.labelPrefix);
  if (explicit) return explicit;
  const runId = input.runId?.trim();
  if (runId && validateRunId(runId)) return cleanPrefix(`agent-${runId}`);
  return cleanPrefix(`agent-${Date.now()}`);
}

function ttlOf(input: AgentAccessInput): number {
  const ttl = Math.floor(Number(input.ttlMinutes ?? DEFAULT_TTL_MINUTES));
  return Math.min(Math.max(ttl, 5), MAX_TTL_MINUTES);
}

export async function issueAgentAccess(
  env: Env,
  auth: AgentAccessAuth,
  input: AgentAccessInput
):
  Promise<
    | {
        ok: true;
        id: string;
        key: string;
        hint: string;
        expiresAt: string;
        ttlMinutes: number;
        scope: { labelPrefix: string; readOnly: boolean };
        policy: {
          purpose: string;
          service: string | null;
          allowSimulate: boolean;
          defaultLabel: string;
          cleanup: { labelPrefix: string };
        };
        env: {
          MAILAGENT_API_URL: string;
          MAILAGENT_API_KEY: string;
          MAILAGENT_LABEL_PREFIX: string;
        };
        next: {
          tool: string;
          payload: Record<string, unknown>;
        };
        note: string;
      }
    | { ok: false; status: 400 | 403 | 429; error: string; hint?: string; max?: number }
  > {
  if (!auth.teamId) {
    return {
      ok: false,
      status: 403,
      error: "team_required",
      hint: "Agent access broker requires a DB-registered team key.",
    };
  }
  if (isRestrictedScope(auth.scope)) {
    return {
      ok: false,
      status: 403,
      error: "scope_admin_required",
      hint: "Use an unrestricted team key to mint temporary agent access.",
    };
  }

  const maxKeys = PLAN_LIMITS[auth.plan].maxTeamKeys;
  const count = await countTeamKeys(env, auth.teamId);
  if (count >= maxKeys) {
    return { ok: false, status: 429, error: "team_key_limit_reached", max: maxKeys };
  }

  const labelPrefix = prefixFromInput(input);
  if (!labelPrefix) {
    return {
      ok: false,
      status: 400,
      error: "invalid_label_prefix",
      hint: "Use letters, numbers, dot, underscore, colon, or dash.",
    };
  }

  const ttlMinutes = ttlOf(input);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const token = generateApiKeyToken();
  const purpose = cleanPurpose(input.purpose);
  const service = input.service?.trim().slice(0, 32) || null;
  const readOnly = input.readOnly ?? false;
  const allowSimulate = input.allowSimulate ?? true;

  const { apiKeyId, hint } = await addTeamKey(env, auth.teamId, {
    token,
    label: `agent:${purpose}`.slice(0, 64),
    scope: { labelPrefix, readOnly },
    expiresAt,
  });

  const defaultLabel = `${labelPrefix}run`;
  return {
    ok: true,
    id: apiKeyId,
    key: token,
    hint,
    expiresAt,
    ttlMinutes,
    scope: { labelPrefix, readOnly },
    policy: {
      purpose,
      service,
      allowSimulate,
      defaultLabel,
      cleanup: { labelPrefix },
    },
    env: {
      MAILAGENT_API_URL: publicApiOrigin(env.MAILAGENT_PUBLIC_API_ORIGIN),
      MAILAGENT_API_KEY: token,
      MAILAGENT_LABEL_PREFIX: labelPrefix,
    },
    next: {
      tool: "mailagent_plan_next",
      payload: {
        ...(service ? { service } : {}),
        label: defaultLabel,
        keepOnFailure: true,
        allowSimulate,
      },
    },
    note: "Save the key now; it is shown only once and expires automatically.",
  };
}
