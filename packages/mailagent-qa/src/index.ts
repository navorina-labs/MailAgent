/**
 * MailAgent QA SDK — inbox per test run, OTP and magic link for Playwright/Cypress.
 */

export interface MailAgentQaConfig {
  apiUrl?: string;
  apiKey: string;
}

export interface CreateInboxOptions {
  ttlMinutes?: number;
  deleteAfterMinutes?: number;
  service?: string;
  expectFrom?: string | string[];
  label?: string;
  callbackUrl?: string;
  /** Relay OTP/summary to developer's real inbox (manual QA) */
  notifyEmail?: string;
  notifyMode?: "verification" | "off";
}

export interface OpenInboxOptions extends CreateInboxOptions {
  timeoutSeconds?: number;
  subjectContains?: string;
  messageIndex?: number;
  deleteAfter?: boolean;
  deleteAfterSuccess?: boolean;
  keepOnFailure?: boolean;
}

export interface HtmlActionCandidate {
  text: string;
  href: string;
  kind: "button" | "link";
  score: number;
}

export interface Verification {
  otp: string | null;
  links: string[];
  primaryLink: string | null;
  buttons?: HtmlActionCandidate[];
  primaryButton?: HtmlActionCandidate | null;
  visibleText?: string;
  filteredLinks?: string[];
  confidence?: "high" | "medium" | "low";
  matchedRule?: string | null;
  reason?: string;
  alternatives?: {
    otp: string[];
    links: string[];
  };
  from?: string;
  subject?: string;
  messageId?: string;
}

export interface InboxInfo {
  id: string;
  address: string;
  expiresAt?: string;
  label?: string | null;
  notifyEmail?: string | null;
  notifyMode?: string | null;
}

export interface NotifyDelivery {
  id: string;
  notifyEmail: string;
  messageId: string | null;
  resendId: string | null;
  ok: boolean;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface OpenResult {
  inboxId: string;
  address: string;
  verification: Verification;
  deleted?: boolean;
  cleanupPolicy?: {
    deleteAfterSuccess: boolean;
    keepOnFailure: boolean;
    deleteAfterMinutes?: number;
  };
  label?: string | null;
}

export interface MessageSummary {
  id?: string;
  from?: string;
  subject?: string;
  receivedAt?: string;
  otp?: string | null;
  links?: string[];
  primaryLink?: string | null;
  buttons?: HtmlActionCandidate[];
  primaryButton?: HtmlActionCandidate | null;
  visibleText?: string;
  filteredLinks?: string[];
  confidence?: "high" | "medium" | "low";
  matchedRule?: string | null;
  reason?: string;
  alternatives?: {
    otp: string[];
    links: string[];
  };
  hasRaw?: boolean;
  rawUrl?: string;
  attachmentCount?: number;
}

export interface AttachmentSummary {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  cached: boolean;
  downloadUrl: string;
}

export interface CallbackDelivery {
  id: string;
  callbackUrl: string;
  messageId: string | null;
  statusCode: number | null;
  ok: boolean;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface DiagnoseAction {
  type:
    | "wait"
    | "adjust_subject_filter"
    | "adjust_message_index"
    | "fix_callback"
    | "extract_verification"
    | "simulate_message"
    | "open_debug_ui";
  confidence: "high" | "medium" | "low";
  reason: string;
  label: string;
  href?: string;
  payload?: Record<string, unknown>;
}

export interface DebugContext {
  inboxId: string;
  address?: string;
  label?: string | null;
  apiMessagesUrl: string;
  debugUiUrl: string;
  messages: MessageSummary[];
  callbacks: CallbackDelivery[];
  troubleshooting: string[];
  failureSummary?: {
    code:
      | "no_messages"
      | "subject_filter_no_match"
      | "message_index_too_high"
      | "callback_failed"
      | "message_received"
      | "unknown";
    message: string;
    confidence: "high" | "medium" | "low";
  };
  recommendedAction?: DiagnoseAction;
  retry?: {
    keepInbox: boolean;
    wait: {
      method: "GET";
      path: string;
      query: {
        timeoutSeconds: number;
        subjectContains?: string;
        messageIndex: number;
      };
    };
    simulate: {
      method: "POST";
      path: string;
      body: {
        subject: string;
        otp: string;
      };
    };
  };
  nextActions?: DiagnoseAction[];
}

export interface FailureArtifactOptions {
  testName?: string;
  runId?: string;
  includeLinks?: boolean;
  includeOtp?: boolean;
}

export interface MailAgentFailureArtifact {
  schemaVersion: 1;
  createdAt: string;
  test?: {
    name?: string;
    runId?: string;
  };
  summary: {
    inboxId: string;
    address?: string;
    label?: string | null;
    failureCode?: DebugContext["failureSummary"] extends infer T
      ? T extends { code: infer C }
        ? C
        : never
      : never;
    message: string;
    confidence?: "high" | "medium" | "low";
    recommendedAction?: Pick<DiagnoseAction, "type" | "confidence" | "label" | "reason">;
    debugUiUrl: string;
    apiMessagesUrl: string;
  };
  retry?: DebugContext["retry"];
  troubleshooting: string[];
  nextActions: Array<Pick<DiagnoseAction, "type" | "confidence" | "label" | "reason">>;
  messages: Array<{
    id?: string;
    from?: string;
    subject?: string;
    receivedAt?: string;
    hasOtp: boolean;
    otp?: string | null;
    linkCount: number;
    links?: string[];
    primaryLink?: string | null;
    buttonCount: number;
    primaryButton?: {
      text: string;
      kind: "button" | "link";
      href?: string;
      score: number;
    } | null;
    confidence?: "high" | "medium" | "low";
    matchedRule?: string | null;
    reason?: string;
    hasRaw?: boolean;
    attachmentCount?: number;
    visibleTextPreview?: string;
  }>;
  callbacks: CallbackDelivery[];
}

export class MailAgentQa {
  private readonly base: string;
  private readonly apiKey: string;

  constructor(config: MailAgentQaConfig) {
    const key = config.apiKey?.trim();
    if (!key) throw new Error("MailAgentQa: apiKey is required");
    this.apiKey = key;
    this.base = (
      config.apiUrl ??
      process.env.MAILAGENT_API_URL ??
      process.env.MAILAGENT_PUBLIC_API_ORIGIN ??
      "https://mail-api.navorina.ai"
    ).replace(/\/$/, "");
  }

  /** TTL from env `QA_TTL_MINUTES` (1–1440), else API default */
  static qaTtlMinutes(): number | undefined {
    const raw = process.env.QA_TTL_MINUTES?.trim();
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(1440, Math.max(1, Math.floor(n)));
  }

  /** Unique label for parallel Playwright workers */
  static runLabel(prefix = "pw"): string {
    const w = process.env.PLAYWRIGHT_WORKER_INDEX ?? process.env.CI_NODE_INDEX ?? "0";
    return `${prefix}-${w}-${Date.now()}`;
  }

  private withQaDefaults<T extends CreateInboxOptions>(options: T): T {
    const ttlMinutes = options.ttlMinutes ?? MailAgentQa.qaTtlMinutes();
    if (ttlMinutes === undefined) return options;
    return { ...options, ttlMinutes };
  }

  async createInbox(options: CreateInboxOptions = {}): Promise<InboxInfo> {
    const body = await this.request<{
      id: string;
      address: string;
      label?: string;
      notifyEmail?: string | null;
      notifyMode?: string | null;
    }>("/v1/inboxes", {
      method: "POST",
      body: JSON.stringify(this.withQaDefaults(options)),
    });
    return {
      id: body.id,
      address: body.address,
      label: body.label,
      notifyEmail: body.notifyEmail,
      notifyMode: body.notifyMode,
    };
  }

  /** Create → wait → extract (recommended for signup flow) */
  async open(options: OpenInboxOptions = {}): Promise<OpenResult> {
    const body = await this.requestRaw("/v1/inboxes/open", {
      method: "POST",
      body: JSON.stringify({
        timeoutSeconds: 90,
        deleteAfter: false,
        ...this.withQaDefaults(options),
      }),
    });

    if (body.status === 408) {
      const err = body.json as { hint?: string; address?: string; inboxId?: string };
      const ctx = err.inboxId
        ? await this.getDebugContext(err.inboxId, {
            subjectContains: options.subjectContains,
            messageIndex: options.messageIndex,
            address: err.address,
            label: options.label,
          }).catch(() => null)
        : null;
      throw new MailAgentTimeoutError(err.hint ?? "timeout", {
        ...err,
        ...(ctx
          ? {
              messages: ctx.messages,
              callbacks: ctx.callbacks,
              troubleshooting: ctx.troubleshooting,
              failureSummary: ctx.failureSummary,
              recommendedAction: ctx.recommendedAction,
              retry: ctx.retry,
              nextActions: ctx.nextActions,
              debugUiUrl: ctx.debugUiUrl,
              failureArtifact: buildFailureArtifact(ctx),
            }
          : {}),
      });
    }
    if (!body.ok) {
      throw new Error(`MailAgent open failed: ${body.status} ${JSON.stringify(body.json)}`);
    }

    const data = body.json as OpenResult & { inboxId: string };
    return {
      inboxId: data.inboxId,
      address: data.address,
      verification: data.verification,
      deleted: data.deleted,
      label: data.label,
    };
  }

  /** Create inbox → fill form → call wait */
  async waitForVerification(
    inboxId: string,
    options?: {
      timeoutSeconds?: number;
      subjectContains?: string;
      messageIndex?: number;
    }
  ): Promise<Verification> {
    const q = new URLSearchParams();
    q.set("timeout", String(options?.timeoutSeconds ?? 120));
    if (options?.subjectContains) q.set("subjectContains", options.subjectContains);
    if (options?.messageIndex != null && options.messageIndex > 0) {
      q.set("messageIndex", String(options.messageIndex));
    }

    const wait = await this.requestRaw(`/v1/inboxes/${inboxId}/wait?${q}`);
    if (wait.status === 408) {
      const body = wait.json as Record<string, unknown>;
      const ctx = await this.getDebugContext(inboxId, {
        subjectContains: options?.subjectContains,
        messageIndex: options?.messageIndex,
      }).catch(() => null);
      throw new MailAgentTimeoutError("No email received", {
        inboxId,
        subjectContains: options?.subjectContains,
        messageIndex: options?.messageIndex,
        ...body,
        messages: ctx?.messages ?? body.subjects ?? [],
        callbacks: ctx?.callbacks ?? [],
        failureSummary: ctx?.failureSummary,
        recommendedAction: ctx?.recommendedAction,
        retry: ctx?.retry,
        nextActions: ctx?.nextActions,
        troubleshooting:
          ctx?.troubleshooting ??
          timeoutTroubleshooting({
            subjectContains: options?.subjectContains,
            messages: (body.subjects as MessageSummary[]) ?? ctx?.messages,
            callbacks: ctx?.callbacks,
          }),
        debugUiUrl: this.debugUiUrl(inboxId),
        failureArtifact: ctx ? buildFailureArtifact(ctx) : undefined,
        hint: (body.hint as string) ?? options?.subjectContains
          ? "Try broader subjectContains or check expectFrom/service allowlist."
          : "Check staging sends mail and Resend webhook is configured.",
      });
    }
    if (!wait.ok) throw new Error(`wait failed: ${wait.status}`);

    const ext = await this.request<Verification>(`/v1/inboxes/${inboxId}/extract`);
    return ext;
  }

  /** Retry wait on timeout (flaky staging / network) */
  async waitWithRetry(
    inboxId: string,
    options?: { timeoutSeconds?: number; subjectContains?: string },
    retries = 3,
    delayMs = 3000
  ): Promise<Verification> {
    let last: MailAgentTimeoutError | undefined;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this.waitForVerification(inboxId, options);
      } catch (e) {
        if (e instanceof MailAgentTimeoutError && attempt < retries) {
          last = e;
          await sleep(delayMs * attempt);
          continue;
        }
        throw e;
      }
    }
    throw last ?? new MailAgentTimeoutError("No email after retries", { inboxId, retries });
  }

  async listMessages(
    inboxId: string,
    options?: { subjectContains?: string }
  ): Promise<MessageSummary[]> {
    const q = new URLSearchParams();
    if (options?.subjectContains) q.set("subjectContains", options.subjectContains);
    const path = q.size
      ? `/v1/inboxes/${inboxId}/messages?${q}`
      : `/v1/inboxes/${inboxId}/messages`;
    const data = await this.request<{ messages: MessageSummary[] }>(path);
    return data.messages ?? [];
  }

  async listAttachments(
    inboxId: string,
    messageId: string
  ): Promise<AttachmentSummary[]> {
    const data = await this.request<{
      attachments: AttachmentSummary[];
    }>(`/v1/inboxes/${inboxId}/messages/${messageId}/attachments`);
    return data.attachments ?? [];
  }

  /** Attachment metadata (Accept: application/json) */
  async getAttachmentMeta(
    inboxId: string,
    messageId: string,
    attachmentId: string
  ) {
    return this.request<{
      id: string;
      filename: string;
      contentType: string;
      sizeBytes: number | null;
      cached: boolean;
      downloadUrl?: string;
      expiresAt?: string;
    }>(
      `/v1/inboxes/${inboxId}/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { Accept: "application/json" } }
    );
  }

  async listCallbackDeliveries(
    inboxId: string,
    limit = 20
  ): Promise<CallbackDelivery[]> {
    const data = await this.request<{ deliveries: CallbackDelivery[] }>(
      `/v1/inboxes/${inboxId}/callbacks?limit=${limit}`
    );
    return data.deliveries ?? [];
  }

  async listNotifyDeliveries(
    inboxId: string,
    limit = 20
  ): Promise<NotifyDelivery[]> {
    const data = await this.request<{ deliveries: NotifyDelivery[] }>(
      `/v1/inboxes/${inboxId}/notify-deliveries?limit=${limit}`
    );
    return data.deliveries ?? [];
  }

  /** Poll notify relay log after simulate or real inbound (manual QA) */
  async waitForNotifyDelivery(
    inboxId: string,
    options?: {
      timeoutSeconds?: number;
      pollIntervalMs?: number;
      since?: Date | string;
      deliveryIndex?: number;
    }
  ): Promise<NotifyDelivery> {
    const timeoutMs = (options?.timeoutSeconds ?? 60) * 1000;
    const pollMs = Math.max(500, options?.pollIntervalMs ?? 1500);
    const sinceMs = options?.since
      ? new Date(options.since).getTime()
      : Date.now();
    const index = Math.max(0, options?.deliveryIndex ?? 0);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const deliveries = await this.listNotifyDeliveries(inboxId, 50);
      const ok = deliveries
        .filter(
          (d) => d.ok && new Date(d.createdAt).getTime() >= sinceMs - 5000
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      const hit = ok[index];
      if (hit) return hit;
      await sleep(pollMs);
    }

    throw new MailAgentTimeoutError("Notify delivery not logged (no ok entry)", {
      inboxId,
      deliveryIndex: index,
      notifyDeliveries: await this.listNotifyDeliveries(inboxId).catch(() => []),
      debugUiUrl: this.debugUiUrl(inboxId),
    });
  }

  /** OTP/links from latest or specific messageId */
  async getVerification(
    inboxId: string,
    messageId?: string
  ): Promise<Verification> {
    if (!messageId) {
      return this.request<Verification>(`/v1/inboxes/${inboxId}/extract`);
    }
    const messages = await this.listMessages(inboxId);
    const m = messages.find((row) => row.id === messageId);
    if (!m) {
      throw new Error(`MailAgent: message ${messageId} not found in inbox ${inboxId}`);
    }
    return {
      otp: m.otp ?? null,
      links: m.links ?? [],
      primaryLink: m.primaryLink ?? null,
      buttons: m.buttons,
      primaryButton: m.primaryButton,
      visibleText: m.visibleText,
      filteredLinks: m.filteredLinks,
      from: m.from,
      subject: m.subject,
      messageId: m.id,
    };
  }

  /**
   * Wait for successful callbackUrl delivery (poll GET …/callbacks).
   * Inbox must be created with callbackUrl; Worker POSTs verification after message.
   */
  async waitForCallback(
    inboxId: string,
    options?: {
      timeoutSeconds?: number;
      pollIntervalMs?: number;
      /** Ignore deliveries before this moment (ISO or Date) */
      since?: Date | string;
      /** 0 = newest ok delivery (default) */
      callbackIndex?: number;
    }
  ): Promise<{ delivery: CallbackDelivery; verification: Verification }> {
    const timeoutMs = (options?.timeoutSeconds ?? 120) * 1000;
    const pollMs = Math.max(500, options?.pollIntervalMs ?? 1500);
    const sinceMs = options?.since
      ? new Date(options.since).getTime()
      : Date.now();
    const index = Math.max(0, options?.callbackIndex ?? 0);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const deliveries = await this.listCallbackDeliveries(inboxId, 50);
      const ok = deliveries
        .filter(
          (d) =>
            d.ok &&
            d.messageId &&
            new Date(d.createdAt).getTime() >= sinceMs - 5000
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      const hit = ok[index];
      if (hit?.messageId) {
        const verification = await this.getVerification(inboxId, hit.messageId);
        return { delivery: hit, verification };
      }
      await sleep(pollMs);
    }

    const ctx = await this.getDebugContext(inboxId).catch(() => null);
    throw new MailAgentTimeoutError("Callback not received (no ok delivery in log)", {
      inboxId,
      callbackIndex: index,
      callbacks: ctx?.callbacks ?? [],
      troubleshooting: [
        "Ensure inbox was created with callbackUrl (HTTPS).",
        "Endpoint must respond 2xx within <10s.",
        "See GET …/callbacks — ok:false and statusCode.",
        ...(ctx?.troubleshooting ?? []),
      ],
      debugUiUrl: this.debugUiUrl(inboxId),
    });
  }

  /** Context for Allure / ReportPortal / CI log — prefers GET …/diagnose */
  async getDebugContext(
    inboxId: string,
    options?: { subjectContains?: string; messageIndex?: number; address?: string; label?: string | null }
  ): Promise<DebugContext> {
    const q = new URLSearchParams();
    if (options?.subjectContains) q.set("subjectContains", options.subjectContains);
    if (options?.messageIndex != null) q.set("messageIndex", String(options.messageIndex));
    const path = `/v1/inboxes/${inboxId}/diagnose${q.size ? `?${q}` : ""}`;

    try {
      const data = await this.request<{
        inboxId: string;
        address: string;
        label: string | null;
        messages: MessageSummary[];
        callbacks: CallbackDelivery[];
        troubleshooting: string[];
        failureSummary?: DebugContext["failureSummary"];
        recommendedAction?: DiagnoseAction;
        retry?: DebugContext["retry"];
        nextActions?: DiagnoseAction[];
        debugUiUrl: string;
        apiMessagesUrl: string;
      }>(path);
      return {
        inboxId: data.inboxId,
        address: options?.address ?? data.address,
        label: options?.label ?? data.label,
        apiMessagesUrl: data.apiMessagesUrl,
        debugUiUrl: data.debugUiUrl,
        messages: data.messages,
        callbacks: data.callbacks,
        troubleshooting: data.troubleshooting,
        failureSummary: data.failureSummary,
        recommendedAction: data.recommendedAction,
        retry: data.retry,
        nextActions: data.nextActions,
      };
    } catch {
      const [messages, callbacks] = await Promise.all([
        this.listMessages(inboxId, {
          subjectContains: options?.subjectContains,
        }).catch(() => [] as MessageSummary[]),
        this.listCallbackDeliveries(inboxId).catch(() => [] as CallbackDelivery[]),
      ]);
      return {
        inboxId,
        address: options?.address,
        label: options?.label,
        apiMessagesUrl: `${this.base}/v1/inboxes/${inboxId}/messages`,
        debugUiUrl: this.debugUiUrl(inboxId),
        messages,
        callbacks,
        troubleshooting: timeoutTroubleshooting({
          subjectContains: options?.subjectContains,
          messageIndex: options?.messageIndex,
          messages,
          callbacks,
        }),
      };
    }
  }

  debugUiUrl(inboxId: string): string {
    const origin = this.base === "https://mail-api.navorina.ai"
      ? "https://agents.navorina.ai"
      : this.base === "https://api.webmailagent.com"
        ? "https://webmailagent.com"
        : this.base;
    return `${origin.replace(/\/$/, "")}/debug.html?inbox=${encodeURIComponent(inboxId)}`;
  }

  /** Label for CI: ci-{GITHUB_RUN_ID}-{worker}-{ts} */
  static ciLabel(prefix = "ci"): string {
    const run = process.env.GITHUB_RUN_ID ?? process.env.CI ?? "local";
    return MailAgentQa.runLabel(`${prefix}-${run}`);
  }

  async listInboxesByPrefix(labelPrefix: string, limit = 50): Promise<InboxInfo[]> {
    const q = new URLSearchParams({
      labelPrefix,
      limit: String(limit),
    });
    const data = await this.request<{ inboxes: Array<InboxInfo & { id: string }> }>(
      `/v1/inboxes?${q}`
    );
    return data.inboxes.map((row) => ({
      id: row.id,
      address: row.address,
      label: row.label,
    }));
  }

  async listInboxes(label: string): Promise<InboxInfo[]> {
    const q = new URLSearchParams({ label });
    const data = await this.request<{ inboxes: Array<InboxInfo & { id: string }> }>(
      `/v1/inboxes?${q}`
    );
    return data.inboxes.map((row) => ({
      id: row.id,
      address: row.address,
      label: row.label,
    }));
  }

  async deleteInbox(inboxId: string): Promise<void> {
    await this.request(`/v1/inboxes/${inboxId}`, { method: "DELETE" });
  }

  /** POST /v1/inboxes/:id/simulate — test OTP without real SMTP */
  async simulateMessage(
    inboxId: string,
    options?: {
      otp?: string;
      from?: string;
      subject?: string;
      /** Preset body/link — see GET /v1/inboxes/simulate/scenarios */
      scenario?: string;
      fireCallback?: boolean;
      attachmentFilename?: string;
      inReplyToMessageId?: string;
      rfcMessageId?: string;
      inReplyTo?: string;
      references?: string;
    }
  ): Promise<{
    inboxId: string;
    messageId: string;
    threadId: string;
    address: string;
    otp: string;
    subject: string;
    attachmentId?: string;
  }> {
    return this.request(`/v1/inboxes/${inboxId}/simulate`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    });
  }

  /** Simulate + wait — E2E without real SMTP (CI offline / SDK smoke) */
  async simulateAndVerify(
    inboxId: string,
    options?: {
      otp?: string;
      from?: string;
      subject?: string;
      scenario?: string;
      subjectContains?: string;
      timeoutSeconds?: number;
      fireCallback?: boolean;
      attachmentFilename?: string;
    }
  ): Promise<Verification> {
    const subject =
      options?.subject ?? (options?.scenario ? undefined : "MailAgent simulated OTP");
    await this.simulateMessage(inboxId, {
      otp: options?.otp,
      from: options?.from,
      ...(subject !== undefined ? { subject } : {}),
      scenario: options?.scenario,
      fireCallback: options?.fireCallback,
      attachmentFilename: options?.attachmentFilename,
    });
    const defaultSubjectContains = options?.scenario ? "Verify" : "simulated";
    return this.waitForVerification(inboxId, {
      subjectContains: options?.subjectContains ?? defaultSubjectContains,
      timeoutSeconds: options?.timeoutSeconds ?? 30,
    });
  }

  /** Delete all inboxes with label starting with prefix (CI cleanup) */
  async cleanupLabelPrefix(labelPrefix: string): Promise<{ deleted: number; ids: string[] }> {
    const q = encodeURIComponent(labelPrefix);
    return this.request(`/v1/inboxes?labelPrefix=${q}`, { method: "DELETE" });
  }

  /** Alias: cleanupLabelPrefix("ci-12345") after job */
  async cleanupRun(runId: string): Promise<{ deleted: number; ids: string[] }> {
    return this.cleanupLabelPrefix(`ci-${runId}`);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.requestRaw(path, init);
    if (!res.ok) {
      if (res.status === 429) {
        throw new MailAgentRateLimitError(res.json, res.headers);
      }
      throw new Error(`MailAgent ${res.status}: ${JSON.stringify(res.json)}`);
    }
    return res.json as T;
  }

  private async requestRaw(path: string, init?: RequestInit) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    return { ok: res.ok, status: res.status, json, headers };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export class MailAgentRateLimitError extends Error {
  constructor(
    readonly body: unknown,
    readonly headers: Record<string, string>
  ) {
    const retry = headers["retry-after"];
    super(
      `MailAgent rate limit${retry ? `, retry after ${retry}s` : ""}: ${JSON.stringify(body)}`
    );
    this.name = "MailAgentRateLimitError";
  }

  get retryAfterSeconds(): number | undefined {
    const v = this.headers["retry-after"];
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
}

/** Attachment for Allure `testInfo.attach(...)` */
export function formatAllureAttachment(ctx: DebugContext): {
  name: string;
  body: string;
  contentType: string;
} {
  return {
    name: "mailagent-debug.json",
    contentType: "application/json",
    body: JSON.stringify(ctx, null, 2),
  };
}

/** Safe CI artifact: summarizes diagnose without raw MIME or full links by default. */
export function buildFailureArtifact(
  ctx: DebugContext,
  options: FailureArtifactOptions = {}
): MailAgentFailureArtifact {
  const recommended = ctx.recommendedAction
    ? pickAction(ctx.recommendedAction)
    : undefined;
  const message =
    ctx.failureSummary?.message ??
    recommended?.reason ??
    (ctx.messages.length
      ? "Mail arrived, but verification did not complete."
      : "No matching email was available before timeout.");

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    ...(options.testName || options.runId
      ? { test: { name: options.testName, runId: options.runId } }
      : {}),
    summary: {
      inboxId: ctx.inboxId,
      address: ctx.address,
      label: ctx.label,
      failureCode: ctx.failureSummary?.code,
      message,
      confidence: ctx.failureSummary?.confidence,
      recommendedAction: recommended,
      debugUiUrl: ctx.debugUiUrl,
      apiMessagesUrl: ctx.apiMessagesUrl,
    },
    retry: sanitizeRetry(ctx.retry, { includeOtp: options.includeOtp ?? false }),
    troubleshooting: ctx.troubleshooting,
    nextActions: (ctx.nextActions ?? []).map(pickAction),
    messages: ctx.messages.map((messageRow) =>
      artifactMessage(messageRow, {
        includeLinks: options.includeLinks ?? false,
        includeOtp: options.includeOtp ?? false,
      })
    ),
    callbacks: ctx.callbacks,
  };
}

/** Attachment for Playwright, Allure, ReportPortal, or upload-artifact. */
export function formatFailureArtifactAttachment(
  ctx: DebugContext,
  options: FailureArtifactOptions = {}
): {
  name: string;
  body: string;
  contentType: string;
} {
  return {
    name: "mailagent-failure.json",
    contentType: "application/json",
    body: JSON.stringify(buildFailureArtifact(ctx, options), null, 2),
  };
}

/** Markdown for GitHub Actions step summary / PR comment snippets. */
export function formatFailureMarkdownSummary(
  ctx: DebugContext,
  options: FailureArtifactOptions = {}
): string {
  const artifact = buildFailureArtifact(ctx, options);
  const action = artifact.summary.recommendedAction;
  const lines = [
    "### MailAgent email debug",
    "",
    `- Inbox: \`${artifact.summary.inboxId}\`${artifact.summary.address ? ` (${artifact.summary.address})` : ""}`,
    `- Failure: ${artifact.summary.failureCode ? `\`${artifact.summary.failureCode}\` ` : ""}${artifact.summary.message}`,
    `- Messages seen: ${artifact.messages.length}`,
    `- Callbacks: ${artifact.callbacks.length}`,
    action
      ? `- Recommended action: \`${action.type}\` (${action.confidence}) — ${action.label}`
      : "- Recommended action: unavailable",
    `- Debug UI: ${artifact.summary.debugUiUrl}`,
  ];
  if (artifact.retry?.wait?.path) {
    lines.push(`- Retry wait: \`${artifact.retry.wait.method} ${artifact.retry.wait.path}\``);
  }
  if (artifact.troubleshooting.length) {
    lines.push("", "Checklist:");
    for (const step of artifact.troubleshooting.slice(0, 5)) {
      lines.push(`- ${step}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Write JSON and optional GitHub step-summary markdown to disk. */
export async function writeFailureArtifact(
  ctx: DebugContext,
  options: FailureArtifactOptions & {
    dir?: string;
    filename?: string;
    writeGitHubStepSummary?: boolean;
  } = {}
): Promise<{ path: string; stepSummaryPath?: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const dir = options.dir ?? process.env.MAILAGENT_ARTIFACT_DIR ?? "test-results/mailagent";
  const filename = options.filename ?? `${safeFilename(ctx.inboxId)}.mailagent-failure.json`;
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, filename);
  await fs.writeFile(
    out,
    JSON.stringify(buildFailureArtifact(ctx, options), null, 2),
    "utf8"
  );

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (options.writeGitHubStepSummary && summaryPath) {
    await fs.appendFile(summaryPath, `\n${formatFailureMarkdownSummary(ctx, options)}\n`, "utf8");
  }

  return {
    path: out,
    stepSummaryPath:
      options.writeGitHubStepSummary && summaryPath ? summaryPath : undefined,
  };
}

export class MailAgentTimeoutError extends Error {
  constructor(
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "MailAgentTimeoutError";
  }
}

function pickAction(action: DiagnoseAction): Pick<DiagnoseAction, "type" | "confidence" | "label" | "reason"> {
  return {
    type: action.type,
    confidence: action.confidence,
    label: action.label,
    reason: action.reason,
  };
}

function artifactMessage(
  message: MessageSummary,
  options: { includeLinks: boolean; includeOtp: boolean }
): MailAgentFailureArtifact["messages"][number] {
  const links = message.links ?? [];
  const buttons = message.buttons ?? [];
  return {
    id: message.id,
    from: message.from,
    subject: message.subject,
    receivedAt: message.receivedAt,
    hasOtp: Boolean(message.otp),
    ...(options.includeOtp ? { otp: message.otp ?? null } : {}),
    linkCount: links.length,
    ...(options.includeLinks ? { links } : {}),
    primaryLink: options.includeLinks
      ? message.primaryLink ?? null
      : redactUrl(message.primaryLink),
    buttonCount: buttons.length,
    primaryButton: message.primaryButton
      ? {
          text: message.primaryButton.text,
          kind: message.primaryButton.kind,
          href: options.includeLinks ? message.primaryButton.href : redactUrl(message.primaryButton.href) ?? undefined,
          score: message.primaryButton.score,
        }
      : null,
    confidence: message.confidence,
    matchedRule: message.matchedRule,
    reason: message.reason,
    hasRaw: message.hasRaw,
    attachmentCount: message.attachmentCount,
    visibleTextPreview: truncate(message.visibleText, 2000),
  };
}

function sanitizeRetry(
  retry: DebugContext["retry"] | undefined,
  options: { includeOtp: boolean }
): DebugContext["retry"] | undefined {
  if (!retry) return undefined;
  return {
    ...retry,
    simulate: {
      ...retry.simulate,
      body: {
        ...retry.simulate.body,
        otp: options.includeOtp ? retry.simulate.body.otp : "[redacted-otp]",
      },
    },
  };
}

function redactUrl(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname ? "/..." : ""}`;
  } catch {
    return "[redacted-url]";
  }
}

function truncate(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120);
}

/** Checklist on timeout / email step failure */
export function timeoutTroubleshooting(input: {
  subjectContains?: string;
  messageIndex?: number;
  messages?: MessageSummary[];
  callbacks?: CallbackDelivery[];
}): string[] {
  const steps: string[] = [];
  const msgs = input.messages ?? [];
  const cbs = input.callbacks ?? [];
  const idx = input.messageIndex ?? 0;

  if (!msgs.length) {
    steps.push("0 messages: check Resend webhook → POST /webhooks/resend and that staging actually sends mail.");
    steps.push("Check service / expectFrom allowlist (GET /v1 for presets).");
  } else if (input.subjectContains) {
    steps.push(
      `${msgs.length} message(s) in inbox, filter subjectContains="${input.subjectContains}", messageIndex=${idx}.`
    );
    if (idx > 0) {
      steps.push("Welcome + verify flow: use messageIndex=1 for the second message.");
    }
  } else if (idx > 0 && msgs.length <= idx) {
    steps.push(`Need messageIndex=${idx}, but list has only ${msgs.length} message(s).`);
  } else {
    steps.push(`${msgs.length} message(s) present — check subjectContains / messageIndex or extract.`);
  }

  const failedCb = cbs.filter((d) => !d.ok);
  if (failedCb.length) {
    steps.push(
      `Callback failed (${failedCb.length}): status ${failedCb.map((d) => d.statusCode).join(", ")} — see GET …/callbacks.`
    );
  } else if (cbs.length) {
    steps.push(`Callbacks OK (${cbs.length} delivery log entries).`);
  }

  steps.push("Open debug UI from error or: GET /v1/inboxes?label=…");
  return steps;
}

/** From env: MAILAGENT_API_URL, MAILAGENT_API_KEY */
export function createMailAgentQa(config?: Partial<MailAgentQaConfig>): MailAgentQa {
  const apiKey = config?.apiKey ?? process.env.MAILAGENT_API_KEY ?? "";
  return new MailAgentQa({
    apiUrl: config?.apiUrl ?? process.env.MAILAGENT_API_URL,
    apiKey,
  });
}
