/** OpenAPI 3.0 — full MailAgent REST API schema */

const bearer = [{ bearerAuth: [] }];

const err = {
  type: "object",
  properties: {
    error: { type: "string" },
  },
} as const;

const inboxBody = {
  type: "object",
  properties: {
    ttlMinutes: { type: "integer", minimum: 1, maximum: 1440 },
    deleteAfterMinutes: {
      type: "integer",
      minimum: 1,
      maximum: 1440,
      description: "Alias for inbox TTL/auto-expiry in minutes",
    },
    service: {
      type: "string",
      description: "Preset allowlist (github, google, …)",
    },
    expectFrom: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    allowedSenders: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
    label: { type: "string", maxLength: 128 },
    callbackUrl: { type: "string", format: "uri", description: "HTTPS webhook" },
    notifyEmail: {
      type: "string",
      format: "email",
      description: "Developer real inbox — OTP summary relay after ingest",
    },
    notifyMode: {
      type: "string",
      enum: ["verification", "off"],
      description: "Relay mode (default verification when notifyEmail set)",
    },
    username: { type: "string", description: "Local part on custom domain" },
    domainId: { type: "string", description: "Verified domain from POST /v1/domains" },
  },
} as const;

const openBody = {
  allOf: [
    inboxBody,
    {
      type: "object",
      properties: {
        subjectContains: { type: "string" },
        messageIndex: { type: "integer", minimum: 0, default: 0 },
        timeoutSeconds: { type: "integer", maximum: 120, default: 90 },
        deleteAfter: { type: "boolean", default: true },
        deleteAfterSuccess: {
          type: "boolean",
          description: "Delete inbox after successful extraction (overrides deleteAfter)",
        },
        keepOnFailure: {
          type: "boolean",
          description: "Keep inbox after timeout/failure for debugging",
        },
      },
    },
  ],
} as const;

const inbox = {
  type: "object",
  properties: {
    id: { type: "string" },
    address: { type: "string" },
    expiresAt: { type: "string", format: "date-time" },
    createdAt: { type: "string", format: "date-time" },
    allowedSenders: { type: "array", items: { type: "string" } },
    label: { type: "string", nullable: true },
    callbackUrl: { type: "string", nullable: true },
    notifyEmail: { type: "string", nullable: true },
    notifyMode: { type: "string", nullable: true },
    messageCount: { type: "integer" },
  },
} as const;

const htmlActionCandidate = {
  type: "object",
  properties: {
    text: { type: "string" },
    href: { type: "string" },
    kind: { type: "string", enum: ["button", "link"] },
    score: { type: "integer" },
  },
} as const;

const message = {
  type: "object",
  properties: {
    id: { type: "string" },
    from: { type: "string" },
    subject: { type: "string" },
    textPreview: { type: "string", nullable: true },
    otp: { type: "string", nullable: true },
    links: { type: "array", items: { type: "string" } },
    primaryLink: { type: "string", nullable: true },
    buttons: { type: "array", items: htmlActionCandidate },
    primaryButton: { ...htmlActionCandidate, nullable: true },
    visibleText: { type: "string" },
    filteredLinks: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    matchedRule: { type: "string", nullable: true },
    reason: { type: "string" },
    alternatives: {
      type: "object",
      properties: {
        otp: { type: "array", items: { type: "string" } },
        links: { type: "array", items: { type: "string" } },
      },
    },
    receivedAt: { type: "string", format: "date-time" },
    hasRaw: {
      type: "boolean",
      description: "Raw MIME stored in R2",
    },
    rawUrl: {
      type: "string",
      description: "Relative path to download .eml",
    },
    attachmentCount: {
      type: "integer",
      description: "Number of attachments on this message",
    },
  },
} as const;

const attachment = {
  type: "object",
  properties: {
    id: { type: "string" },
    filename: { type: "string" },
    contentType: { type: "string", nullable: true },
    sizeBytes: { type: "integer", nullable: true },
    contentDisposition: { type: "string", nullable: true },
    contentId: { type: "string", nullable: true },
    cached: { type: "boolean" },
    downloadUrl: { type: "string" },
  },
} as const;

const verification = {
  type: "object",
  properties: {
    otp: { type: "string", nullable: true },
    links: { type: "array", items: { type: "string" } },
    primaryLink: { type: "string", nullable: true },
    buttons: { type: "array", items: htmlActionCandidate },
    primaryButton: { ...htmlActionCandidate, nullable: true },
    visibleText: { type: "string" },
    filteredLinks: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    matchedRule: { type: "string", nullable: true },
    reason: { type: "string" },
    alternatives: {
      type: "object",
      properties: {
        otp: { type: "array", items: { type: "string" } },
        links: { type: "array", items: { type: "string" } },
      },
    },
    from: { type: "string" },
    subject: { type: "string" },
    messageId: { type: "string" },
  },
} as const;

const diagnoseAction = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: [
        "wait",
        "adjust_subject_filter",
        "adjust_message_index",
        "fix_callback",
        "extract_verification",
        "simulate_message",
        "open_debug_ui",
      ],
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string" },
    label: { type: "string" },
    href: { type: "string" },
    payload: { type: "object", additionalProperties: true },
  },
} as const;

const callbackDelivery = {
  type: "object",
  properties: {
    id: { type: "string" },
    callbackUrl: { type: "string" },
    messageId: { type: "string", nullable: true },
    statusCode: { type: "integer", nullable: true },
    ok: { type: "boolean" },
    error: { type: "string", nullable: true },
    durationMs: { type: "integer", nullable: true },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const notifyDelivery = {
  type: "object",
  properties: {
    id: { type: "string" },
    notifyEmail: { type: "string" },
    messageId: { type: "string", nullable: true },
    resendId: { type: "string", nullable: true },
    ok: { type: "boolean" },
    error: { type: "string", nullable: true },
    durationMs: { type: "integer", nullable: true },
    createdAt: { type: "string", format: "date-time" },
  },
} as const;

const agentRunTimelineEvent = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: [
        "inbox_created",
        "wait_started",
        "message_received",
        "extraction_success",
        "extraction_failure",
        "callback_delivery",
        "notify_delivery",
        "diagnose_run",
        "session_step",
      ],
    },
    at: { type: "string", format: "date-time" },
    title: { type: "string" },
    status: { type: "string", enum: ["info", "success", "failure", "timeout"] },
    inboxId: { type: "string" },
    messageId: { type: "string" },
    data: { type: "object", additionalProperties: true },
  },
} as const;

const agentRunSession = {
  type: "object",
  properties: {
    runId: { type: "string" },
    state: { type: "object", additionalProperties: true },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          at: { type: "string", format: "date-time" },
          data: { type: "object", additionalProperties: true },
        },
      },
    },
    timeline: { type: "array", items: agentRunTimelineEvent },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
} as const;

const domain = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    status: { type: "string", enum: ["pending", "verified", "failed"] },
    region: { type: "string", nullable: true },
    dnsRecords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          name: { type: "string" },
          value: { type: "string" },
          priority: { type: "integer", nullable: true },
          status: { type: "string" },
        },
      },
    },
    createdAt: { type: "string", format: "date-time" },
    verifiedAt: { type: "string", format: "date-time", nullable: true },
  },
} as const;

const workspaceMailMessage = {
  type: "object",
  properties: {
    id: { type: "string" },
    from: { type: "string" },
    to: { type: "array", items: { type: "string" } },
    cc: { type: "array", items: { type: "string" } },
    subject: { type: "string" },
    text: { type: "string" },
    receivedAt: { type: "string", format: "date-time" },
  },
} as const;

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "MailAgent API",
    version: "0.2.1",
    description:
      "Temporary inboxes for AI agents and QA. Bearer auth on /v1 except webhooks.",
  },
  servers: [{ url: "http://127.0.0.1:8787", description: "Local wrangler dev" }],
  tags: [
    { name: "meta", description: "Discovery and stats" },
    { name: "inboxes", description: "Temporary inboxes" },
    { name: "webhooks", description: "Inbound email (Resend)" },
    { name: "health", description: "Health check" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      Error: err,
      InboxCreate: inboxBody,
      InboxOpen: openBody,
      Inbox: inbox,
      Message: message,
      Verification: verification,
      CallbackDelivery: callbackDelivery,
      AgentRunSession: agentRunSession,
      AgentRunTimelineEvent: agentRunTimelineEvent,
      Domain: domain,
      WorkspaceMailMessage: workspaceMailMessage,
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid Bearer token",
        content: { "application/json": { schema: err } },
      },
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: err } },
      },
      RateLimited: {
        description: "Too many requests per API key",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                error: { type: "string", example: "rate_limit_exceeded" },
                limitPerMinute: { type: "integer" },
                retryAfterSeconds: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["health"],
        summary: "Health check",
        security: [],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    db: { type: "boolean" },
                    version: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1": {
      get: {
        tags: ["meta"],
        summary: "API discovery",
        security: bearer,
        responses: { "200": { description: "Endpoints, presets, MCP tools" } },
      },
    },
    "/v1/openapi.json": {
      get: {
        tags: ["meta"],
        summary: "OpenAPI document",
        security: [],
        responses: { "200": { description: "This schema" } },
      },
    },
    "/v1/keys/request": {
      post: {
        tags: ["meta"],
        summary: "Request a free API key (emails a one-time confirmation link)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string", format: "email" } },
              },
            },
          },
        },
        responses: {
          "202": { description: "sent" },
          "400": { description: "invalid_email, inbox_domain_not_allowed, disposable_email, email_not_deliverable" },
          "429": { description: "rate_limit_exceeded (5 per hour per IP, 3 per hour per email)" },
          "503": { description: "signup_unavailable" },
        },
      },
    },
    "/v1/keys/confirm": {
      post: {
        tags: ["meta"],
        summary: "Confirm the emailed link and receive a Free API key once",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token"],
                properties: { token: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "201": { description: "apiKey, teamId, plan, limits" },
          "400": { description: "invalid_or_expired_token" },
          "409": { description: "key_limit_reached" },
          "429": { description: "rate_limit_exceeded" },
        },
      },
    },
    "/v1/upgrade/config": {
      get: {
        tags: ["meta"],
        summary: "Whether self-serve Stripe billing is enabled",
        security: [],
        responses: { "200": { description: "{ billing: boolean }" } },
      },
    },
    "/v1/upgrade/request": {
      post: {
        tags: ["meta"],
        summary: "Email a one-time link to Pro checkout or the billing portal ($29/month)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "action"],
                properties: {
                  email: { type: "string", format: "email" },
                  action: { type: "string", enum: ["checkout", "portal"] },
                },
              },
            },
          },
        },
        responses: {
          "202": { description: "Link sent (same answer when the email has no account)" },
          "400": { description: "invalid_email, invalid_action" },
          "429": { description: "rate_limit_exceeded" },
          "503": { description: "billing_unavailable" },
        },
      },
    },
    "/v1/upgrade/confirm": {
      post: {
        tags: ["meta"],
        summary: "Exchange the emailed token for a Stripe Checkout or portal URL",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["token"], properties: { token: { type: "string" } } },
            },
          },
        },
        responses: {
          "200": { description: "{ action, url }" },
          "400": { description: "invalid_or_expired_token" },
          "409": { description: "already_pro, no_subscription" },
          "502": { description: "stripe_failed" },
          "503": { description: "billing_unavailable" },
        },
      },
    },
    "/webhooks/stripe": {
      post: {
        tags: ["meta"],
        summary: "Stripe events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted",
        security: [],
        responses: {
          "200": { description: "received (duplicate: true for an already handled event id)" },
          "400": { description: "invalid_stripe_signature" },
          "503": { description: "billing_unavailable" },
        },
      },
    },
    "/v1/pilot-requests": {
      post: {
        tags: ["meta"],
        summary: "Request a pilot (public landing form, emailed to the team)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                  name: { type: "string", maxLength: 100 },
                  company: { type: "string", maxLength: 120 },
                  productUrl: { type: "string", format: "uri", maxLength: 300 },
                  flows: {
                    type: "array",
                    items: { type: "string", enum: ["signup", "login", "password_reset", "invite", "2fa"] },
                  },
                  runner: { type: "string", maxLength: 120 },
                  message: { type: "string", maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: {
          "202": { description: "received" },
          "400": { description: "invalid_email, invalid_flows, invalid_product_url, field_too_long" },
          "429": { description: "rate_limit_exceeded (5 per hour per IP)" },
          "503": { description: "pilot_unavailable" },
        },
      },
    },
    "/v1/emails/check": {
      post: {
        tags: ["meta"],
        summary: "Check email (syntax, disposable, role, MX via DNS)",
        security: bearer,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: {
                  email: { type: "string", format: "email" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "local check result" },
          "400": { description: "invalid_email" },
        },
      },
    },
    "/v1/agent/preset-advice": {
      post: {
        tags: ["meta"],
        summary: "Suggest agent service preset and wait parameters from a sample auth email",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  service: { type: "string" },
                  from: { type: "string" },
                  subject: { type: "string" },
                  text: { type: "string" },
                  html: { type: "string" },
                  flow: {
                    type: "string",
                    enum: [
                      "signup",
                      "login",
                      "password_reset",
                      "invite_accept",
                      "magic_link_login",
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Recommended service, expectFrom, subjectContains, flow, extraction hints, and snippets",
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/v1/agent/autopilot": {
      post: {
        tags: ["meta"],
        summary: "Plan the next best agent action for email verification or Workspace follow-up",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  inboxId: { type: "string" },
                  status: {
                    type: "string",
                    enum: [
                      "start",
                      "address_ready",
                      "form_submitted",
                      "timeout",
                      "message_received",
                      "verified",
                      "failed",
                    ],
                  },
                  service: { type: "string" },
                  from: { type: "string" },
                  subject: { type: "string" },
                  text: { type: "string" },
                  html: { type: "string" },
                  flow: {
                    type: "string",
                    enum: [
                      "signup",
                      "login",
                      "password_reset",
                      "invite_accept",
                      "magic_link_login",
                    ],
                  },
                  runId: { type: "string" },
                  label: { type: "string" },
                  subjectContains: { type: "string" },
                  messageIndex: { type: "integer", minimum: 0 },
                  timeoutSeconds: { type: "integer", minimum: 5, maximum: 120 },
                  deleteAfterSuccess: { type: "boolean" },
                  keepOnFailure: { type: "boolean" },
                  allowSimulate: { type: "boolean" },
                  lastError: { type: "string" },
                  openReminders: {
                    type: "array",
                    description:
                      "Optional Workspace reminder queue. If no inbox flow is active, planner returns a follow-up draft action.",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        title: { type: "string" },
                        dueAt: { type: "string" },
                        dueHint: { type: "string" },
                        sourceThreadId: { type: "string" },
                        sourceMessageId: { type: "string" },
                        status: { type: "string" },
                        meta: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                  workspaceActions: {
                    type: "array",
                    description:
                      "Recent Workspace action history, newest first. Prevents duplicate drafts and completed work.",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        reminderId: { type: "string" },
                        threadId: { type: "string" },
                        messageId: { type: "string" },
                        actionType: {
                          type: "string",
                          enum: [
                            "draft_prepared",
                            "waiting",
                            "completed",
                            "blocked",
                            "sent",
                            "send_denied",
                            "send_failed",
                            "note",
                          ],
                        },
                        title: { type: "string" },
                        note: { type: "string" },
                        status: { type: "string", enum: ["done", "waiting", "blocked"] },
                        createdAt: { type: "string" },
                        meta: { type: "object", additionalProperties: true },
                      },
                    },
                  },
                  workspacePolicy: {
                    type: "object",
                    properties: {
                      mode: {
                        type: "string",
                        enum: ["draft_only", "auto_send_safe", "full_auto"],
                      },
                      allowedRecipientDomains: {
                        type: "array",
                        items: { type: "string" },
                      },
                      minConfidence: {
                        type: "string",
                        enum: ["low", "medium", "high"],
                      },
                      maxSendsPerHour: { type: "integer", minimum: 1, maximum: 100 },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Autopilot plan with nextTool, nextPayload, steps, guardrails, preset advice, and optional diagnose recovery",
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/v1/agent/access": {
      post: {
        tags: ["meta"],
        summary: "Issue a short-lived scoped key for one autonomous agent run",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  purpose: { type: "string", maxLength: 64 },
                  runId: { type: "string" },
                  labelPrefix: {
                    type: "string",
                    description: "Access boundary for created inbox labels; generated from runId if omitted",
                  },
                  ttlMinutes: { type: "integer", minimum: 5, maximum: 1440, default: 240 },
                  readOnly: { type: "boolean", default: false },
                  service: { type: "string" },
                  allowSimulate: { type: "boolean", default: true },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description:
              "One-time API key, expiry, labelPrefix policy, environment block, and next planner payload",
          },
          "400": { description: "invalid_label_prefix" },
          "403": { description: "team_required or scope_admin_required" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/v1/stats": {
      get: {
        tags: ["meta"],
        summary: "Usage counters",
        security: bearer,
        responses: {
          "200": {
            description: "Active inboxes, messages 24h, limits",
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/v1/agent/runs": {
      get: {
        tags: ["meta"],
        summary: "List active agent runs grouped by runId",
        security: bearer,
        parameters: [
          { name: "runId", in: "query", schema: { type: "string" } },
          { name: "label", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 100 } },
        ],
        responses: { "200": { description: "Agent run summaries" } },
      },
    },
    "/v1/agent/runs/{runId}": {
      get: {
        tags: ["meta"],
        summary: "Get agent run detail including session and timeline",
        security: bearer,
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Agent run detail" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/agent/runs/start": {
      post: {
        tags: ["meta"],
        summary: "Start an autonomous agent run session and return first plan",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  runId: { type: "string" },
                  appUrl: { type: "string" },
                  notes: { type: "string" },
                  service: { type: "string" },
                  subject: { type: "string" },
                  flow: { type: "string" },
                  subjectContains: { type: "string" },
                  timeoutSeconds: { type: "integer", minimum: 5, maximum: 120 },
                  deleteAfterSuccess: { type: "boolean" },
                  keepOnFailure: { type: "boolean" },
                  allowSimulate: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Run session, initial step, and autopilot plan" },
          "400": { description: "invalid_run_id | state_too_large | invalid_step" },
        },
      },
    },
    "/v1/agent/runs/{runId}/next": {
      post: {
        tags: ["meta"],
        summary: "Resume an agent run and return the next plan",
        security: bearer,
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string" },
                  inboxId: { type: "string" },
                  service: { type: "string" },
                  subjectContains: { type: "string" },
                  lastError: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Run session and next autopilot plan" },
          "400": { description: "invalid_run_id | state_too_large" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/agent/runs/{runId}/report": {
      post: {
        tags: ["meta"],
        summary: "Report agent run progress or failure and return the next plan",
        security: bearer,
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string" },
                  step: { type: "string" },
                  error: { type: "string" },
                  result: { type: "object", additionalProperties: true },
                  inboxId: { type: "string" },
                  service: { type: "string" },
                  subjectContains: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated run session and next autopilot plan" },
          "400": { description: "invalid_run_id | state_too_large | invalid_step" },
        },
      },
    },
    "/v1/agent/runs/{runId}/session": {
      get: {
        tags: ["meta"],
        summary: "Get multi-step agent run session",
        security: bearer,
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentRunSession" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["meta"],
        summary: "Patch agent run state or append a step",
        security: bearer,
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  merge: { type: "object", additionalProperties: true },
                  replaceState: { type: "object", additionalProperties: true },
                  step: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      data: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AgentRunSession" },
              },
            },
          },
          "400": { description: "invalid_run_id | state_too_large | invalid_step" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/agent/runs/{runId}/timeline": {
      get: {
        tags: ["meta"],
        summary: "Get normalized agent run timeline",
        security: bearer,
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    runId: { type: "string" },
                    timeline: {
                      type: "array",
                      items: { $ref: "#/components/schemas/AgentRunTimelineEvent" },
                    },
                    createdAt: { type: "string", format: "date-time" },
                    updatedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/workspace": {
      get: {
        tags: ["meta"],
        summary: "Workspace Agent autonomy discovery",
        security: bearer,
        responses: {
          "200": { description: "Workspace Agent safety posture, model provider, and endpoints" },
        },
      },
    },
    "/v1/workspace/summarize": {
      post: {
        tags: ["meta"],
        summary: "Summarize supplied workspace mail messages",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadId: { type: "string" },
                  goal: { type: "string" },
                  messages: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WorkspaceMailMessage" },
                  },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Summary, action items, decisions, and open questions" } },
      },
    },
    "/v1/workspace/draft-reply": {
      post: {
        tags: ["meta"],
        summary: "Draft a reply without sending",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadId: { type: "string" },
                  goal: { type: "string" },
                  tone: { type: "string", enum: ["concise", "friendly", "formal"] },
                  instruction: { type: "string" },
                  messages: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WorkspaceMailMessage" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Draft text, confidence, risks/missing context, approval required, and public provider metadata",
          },
        },
      },
    },
    "/v1/workspace/reminders/suggest": {
      post: {
        tags: ["meta"],
        summary: "Suggest reminders and follow-ups from supplied messages",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  threadId: { type: "string" },
                  now: { type: "string", format: "date-time" },
                  timezone: { type: "string" },
                  messages: {
                    type: "array",
                    items: { $ref: "#/components/schemas/WorkspaceMailMessage" },
                  },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Reminder/follow-up suggestions" } },
      },
    },
    "/v1/workspace/reminders": {
      get: {
        tags: ["meta"],
        summary: "List saved Workspace Agent reminders/follow-ups",
        security: bearer,
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["open", "completed", "all"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": { description: "Saved reminders/follow-ups" } },
      },
      post: {
        tags: ["meta"],
        summary: "Create a Workspace Agent reminder/follow-up",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  dueAt: { type: "string", format: "date-time" },
                  dueHint: { type: "string" },
                  source: { type: "string" },
                  sourceThreadId: { type: "string" },
                  sourceMessageId: { type: "string" },
                  meta: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created reminder/follow-up" },
          "400": { description: "title_required | invalid_due_at" },
        },
      },
    },
    "/v1/workspace/reminders/{id}/complete": {
      patch: {
        tags: ["meta"],
        summary: "Mark a Workspace Agent reminder/follow-up as completed",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Completed reminder/follow-up" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/workspace/actions": {
      get: {
        tags: ["meta"],
        summary: "List Workspace Agent action log entries",
        security: bearer,
        parameters: [
          { name: "reminderId", in: "query", schema: { type: "string" } },
          { name: "threadId", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": { description: "Workspace action log entries" } },
      },
      post: {
        tags: ["meta"],
        summary: "Log a Workspace Agent action",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title"],
                properties: {
                  title: { type: "string" },
                  actionType: {
                    type: "string",
                    enum: [
                      "draft_prepared",
                      "waiting",
                      "completed",
                      "blocked",
                      "sent",
                      "send_denied",
                      "send_failed",
                      "note",
                    ],
                  },
                  status: { type: "string", enum: ["done", "waiting", "blocked"] },
                  note: { type: "string" },
                  reminderId: { type: "string" },
                  threadId: { type: "string" },
                  messageId: { type: "string" },
                  meta: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Logged Workspace action" },
          "400": { description: "title_required | invalid_action_type | invalid_status" },
        },
      },
    },
    "/v1/workspace/policy": {
      get: {
        tags: ["meta"],
        summary: "Read Workspace Agent autonomy policy",
        security: bearer,
        responses: {
          "200": { description: "Policy plus immutable safety constraints" },
        },
      },
      put: {
        tags: ["meta"],
        summary: "Configure Workspace Agent autonomy policy (admin key required)",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["mode"],
                properties: {
                  mode: {
                    type: "string",
                    enum: ["draft_only", "auto_send_safe", "full_auto"],
                  },
                  allowedRecipientDomains: {
                    type: "array",
                    items: { type: "string" },
                  },
                  minConfidence: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                  },
                  maxSendsPerHour: { type: "integer", minimum: 1, maximum: 100 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated policy" },
          "400": { description: "Invalid policy" },
          "403": { description: "Unrestricted admin key required" },
        },
      },
    },
    "/v1/workspace/models": {
      get: {
        tags: ["meta"],
        summary: "Read DeepSeek/Qwen readiness and fallback priority",
        security: bearer,
        responses: {
          "200": { description: "Secret-free provider readiness metadata" },
        },
      },
    },
    "/v1/workspace/models/probe": {
      post: {
        tags: ["meta"],
        summary: "Run an admin-only live Workspace model probe",
        security: bearer,
        responses: {
          "200": { description: "Selected provider or machine-readable failed attempts" },
          "403": { description: "Unrestricted admin key required" },
        },
      },
    },
    "/v1/workspace/execute-reply": {
      post: {
        tags: ["meta"],
        summary: "Draft and policy-gate an autonomous reply to a stored inbound message",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["inboxId", "messageId"],
                properties: {
                  inboxId: { type: "string" },
                  messageId: { type: "string" },
                  reminderId: { type: "string" },
                  idempotencyKey: {
                    type: "string",
                    description: "Required for a real send; prevents duplicate delivery",
                  },
                  instruction: { type: "string" },
                  tone: { type: "string", enum: ["concise", "friendly", "formal"] },
                  dryRun: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Dry run or policy-denied execution" },
          "201": { description: "Reply sent exactly once and execution recorded" },
          "400": { description: "Invalid execution request" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/domains": {
      get: {
        tags: ["domains"],
        summary: "List custom domains (team or API key scoped)",
        security: bearer,
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    domains: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Domain" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["domains"],
        summary: "Register domain in Resend (returns DNS records)",
        security: bearer,
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "201": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Domain" },
              },
            },
          },
          "409": { description: "domain_already_registered" },
          "429": { description: "domain_limit_reached" },
        },
      },
    },
    "/v1/domains/{id}": {
      get: {
        tags: ["domains"],
        summary: "Get domain + DNS records",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Domain" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["domains"],
        summary: "Remove domain from Resend and MailAgent",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "deleted" } },
      },
    },
    "/v1/domains/{id}/verify": {
      post: {
        tags: ["domains"],
        summary: "Poll DNS verification status",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Domain" },
              },
            },
          },
        },
      },
    },
    "/v1/inboxes": {
      get: {
        tags: ["inboxes"],
        summary: "List inboxes (label or labelPrefix filter)",
        security: bearer,
        parameters: [
          { name: "label", in: "query", schema: { type: "string" } },
          {
            name: "labelPrefix",
            in: "query",
            schema: { type: "string", minLength: 3 },
            description: "label LIKE prefix%",
          },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 50 } },
        ],
        responses: {
          "200": {
            description: "Inboxes for current API key",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    inboxes: { type: "array", items: inbox },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["inboxes"],
        summary: "Create inbox",
        security: bearer,
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/InboxCreate" } } },
        },
        responses: {
          "201": {
            content: {
              "application/json": { schema: inbox },
            },
          },
          "400": {
            description: "invalid_callback_url or invalid_notify_email",
          },
          "429": {
            description: "inbox_limit_reached or notify_quota_exceeded",
          },
        },
      },
      delete: {
        tags: ["inboxes"],
        summary: "Bulk delete by label prefix (QA cleanup)",
        security: bearer,
        parameters: [
          {
            name: "labelPrefix",
            in: "query",
            required: true,
            schema: { type: "string", minLength: 3 },
            description: "Delete inboxes where label LIKE prefix% (scoped to API key)",
          },
        ],
        responses: {
          "200": {
            description: "Deleted inbox ids",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    deleted: { type: "integer" },
                    ids: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          "400": { description: "labelPrefix_required | labelPrefix_too_short" },
        },
      },
    },
    "/v1/inboxes/open": {
      post: {
        tags: ["inboxes"],
        summary: "Create, wait, extract, optional delete",
        security: bearer,
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/InboxOpen" } } },
        },
        responses: {
          "200": { description: "Verification payload" },
          "408": { description: "timeout" },
          "429": {
            description: "inbox_limit_reached or notify_quota_exceeded",
          },
        },
      },
    },
    "/v1/inboxes/{id}": {
      get: {
        tags: ["inboxes"],
        summary: "Get inbox",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { content: { "application/json": { schema: inbox } } },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["inboxes"],
        summary: "Delete inbox",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { deleted: { type: "boolean" } },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/inboxes/{id}/messages": {
      get: {
        tags: ["inboxes"],
        summary: "List messages (optional subject filter)",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "subjectContains",
            in: "query",
            schema: { type: "string" },
            description: "Case-insensitive substring match on subject",
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messages: { type: "array", items: message },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/inboxes/{id}/messages/{messageId}/attachments": {
      get: {
        tags: ["inboxes"],
        summary: "List attachment metadata for a message",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "messageId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messageId: { type: "string" },
                    attachments: { type: "array", items: attachment },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/inboxes/{id}/messages/{messageId}/attachments/{attachmentId}": {
      get: {
        tags: ["inboxes"],
        summary: "Download attachment bytes or JSON metadata",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "messageId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "attachmentId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "File stream or JSON with Resend signed downloadUrl",
            content: {
              "application/octet-stream": { schema: { type: "string", format: "binary" } },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    filename: { type: "string" },
                    contentType: { type: "string" },
                    sizeBytes: { type: "integer", nullable: true },
                    cached: { type: "boolean" },
                    downloadUrl: { type: "string" },
                    expiresAt: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "502": { description: "Resend attachment fetch failed" },
        },
      },
    },
    "/v1/inboxes/{id}/messages/{messageId}/raw": {
      get: {
        tags: ["inboxes"],
        summary: "Download raw MIME (.eml) from R2",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          {
            name: "messageId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Raw email (message/rfc822) or JSON metadata with Accept: application/json",
            content: {
              "message/rfc822": { schema: { type: "string", format: "binary" } },
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messageId: { type: "string" },
                    inboxId: { type: "string" },
                    contentType: { type: "string" },
                    sizeBytes: { type: "integer" },
                    filename: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "503": { description: "R2 binding not configured" },
        },
      },
    },
    "/v1/inboxes/{id}/extract": {
      get: {
        tags: ["inboxes"],
        summary: "OTP and links from latest message",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            content: {
              "application/json": { schema: verification },
            },
          },
          "404": { description: "no_messages" },
        },
      },
    },
    "/v1/inboxes/{id}/wait": {
      get: {
        tags: ["inboxes"],
        summary: "Poll until first message",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "timeout", in: "query", schema: { type: "integer", maximum: 120 } },
          { name: "subjectContains", in: "query", schema: { type: "string" } },
          {
            name: "messageIndex",
            in: "query",
            schema: { type: "integer", minimum: 0, default: 0 },
            description: "0=newest matching message, 1=second, …",
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { message: message },
                },
              },
            },
          },
          "408": {
            description: "timeout with subjects list for QA debug",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    inboxId: { type: "string" },
                    messageCount: { type: "integer" },
                    matchingCount: { type: "integer" },
                    messageIndex: { type: "integer" },
                    hint: { type: "string" },
                    subjects: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          subject: { type: "string" },
                          from: { type: "string" },
                          otp: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/inboxes/{id}/events": {
      get: {
        tags: ["inboxes"],
        summary: "SSE stream for new messages",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "text/event-stream" },
        },
      },
    },
    "/v1/inboxes/{id}/diagnose": {
      get: {
        tags: ["inboxes"],
        summary: "Debug wait failures — messages, callbacks, troubleshooting, recovery hints",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "subjectContains", in: "query", schema: { type: "string" } },
          { name: "messageIndex", in: "query", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    inboxId: { type: "string" },
                    address: { type: "string" },
                    messageCount: { type: "integer" },
                    messages: { type: "array", items: message },
                    troubleshooting: { type: "array", items: { type: "string" } },
                    failureSummary: {
                      type: "object",
                      properties: {
                        code: {
                          type: "string",
                          enum: [
                            "no_messages",
                            "subject_filter_no_match",
                            "message_index_too_high",
                            "callback_failed",
                            "message_received",
                            "unknown",
                          ],
                        },
                        message: { type: "string" },
                        confidence: { type: "string", enum: ["high", "medium", "low"] },
                      },
                    },
                    recommendedAction: diagnoseAction,
                    retry: {
                      type: "object",
                      properties: {
                        keepInbox: { type: "boolean" },
                        wait: { type: "object", additionalProperties: true },
                        simulate: { type: "object", additionalProperties: true },
                      },
                    },
                    nextActions: { type: "array", items: diagnoseAction },
                    debugUiUrl: { type: "string", format: "uri" },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/inboxes/{id}/extract/presets": {
      get: {
        tags: ["inboxes"],
        summary: "List structured extraction presets",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "2fa, invoice, receipt presets" } },
      },
    },
    "/v1/inboxes/{id}/messages/{messageId}/extract": {
      post: {
        tags: ["inboxes"],
        summary: "Structured JSON extract (preset or custom schema)",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  preset: { type: "string", enum: ["2fa", "invoice", "receipt"] },
                  schema: { type: "object" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messageId: { type: "string" },
                    preset: { type: "string", nullable: true },
                    extractor: { type: "string", enum: ["rules", "ai", "hybrid"] },
                    data: { type: "object" },
                  },
                },
              },
            },
          },
          "501": { description: "ai_required_for_custom_schema" },
        },
      },
    },
    "/v1/inboxes/{id}/search": {
      get: {
        tags: ["inboxes"],
        summary: "Search messages (keyword + optional semantic)",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 50 } },
          {
            name: "mode",
            in: "query",
            schema: { type: "string", enum: ["auto", "keyword", "semantic"] },
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    query: { type: "string" },
                    mode: { type: "string" },
                    semanticAvailable: { type: "boolean" },
                    results: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          messageId: { type: "string" },
                          score: { type: "number" },
                          matchType: { type: "string" },
                          subject: { type: "string" },
                          from: { type: "string" },
                          snippet: { type: "string" },
                          receivedAt: { type: "string" },
                          otp: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "q_required" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/inboxes/{id}/simulate": {
      post: {
        tags: ["inboxes"],
        summary: "Inject test OTP email without Resend (QA/dev)",
        security: bearer,
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  otp: { type: "string" },
                  from: { type: "string" },
                  subject: { type: "string" },
                  fireCallback: { type: "boolean" },
                  attachmentFilename: { type: "string" },
                  inReplyToMessageId: {
                    type: "string",
                    description: "Parent message id for threading tests",
                  },
                  rfcMessageId: { type: "string" },
                  inReplyTo: { type: "string" },
                  references: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    inboxId: { type: "string" },
                    messageId: { type: "string" },
                    threadId: { type: "string" },
                    address: { type: "string" },
                    otp: { type: "string" },
                    subject: { type: "string" },
                    attachmentId: { type: "string" },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "500": { description: "simulate_failed" },
        },
      },
    },
    "/v1/inboxes/{id}/notify-deliveries": {
      get: {
        tags: ["inboxes"],
        summary: "Developer email relay delivery log",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 50 } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    deliveries: {
                      type: "array",
                      items: notifyDelivery,
                    },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/v1/inboxes/{id}/callbacks": {
      get: {
        tags: ["inboxes"],
        summary: "Callback delivery log (QA webhook debug)",
        security: bearer,
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 50 } },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    deliveries: {
                      type: "array",
                      items: callbackDelivery,
                    },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/webhooks/resend": {
      post: {
        tags: ["webhooks"],
        summary: "Resend inbound email",
        security: [],
        responses: {
          "200": { description: "Accepted" },
          "401": { description: "Invalid webhook signature" },
        },
      },
    },
  },
} as const;
