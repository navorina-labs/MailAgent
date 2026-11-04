/** Cloudflare Worker bindings + secrets */
export interface Env {
  ASSETS: Fetcher;
  DATABASE_URL: string;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  API_KEY: string;
  /** Optional: pilot keys comma-separated (hosted) */
  API_KEYS?: string;
  INBOX_DOMAIN: string;
  /** Canonical public API origin used in generated links and OAuth metadata. */
  MAILAGENT_PUBLIC_API_ORIGIN?: string;
  /** Canonical console/docs origin used in redirects and user-facing links. */
  MAILAGENT_WORKSPACE_ORIGIN?: string;
  DEFAULT_TTL_MINUTES: string;
  MAIL_QUEUE: Queue<EmailQueueMessage>;
  INBOX_WAIT: DurableObjectNamespace;
  /** Optional: rate limit per API key (hosted) */
  /** Sampled KV writes for rate limit (default: every 10th request) */
  RATE_LIMIT_KV_WRITE_EVERY?: string;
  RATE_LIMIT?: KVNamespace;
  RATE_LIMIT_PER_MINUTE?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** Price id (price_…) for Pro subscription */
  STRIPE_PRICE_PRO?: string;
  /** OAuth access token TTL for MCP (seconds, default 3600) */
  MCP_OAUTH_TOKEN_TTL_SEC?: string;
  /** HMAC secret for stateless mat_ JWT (default: API_KEY) */
  MCP_OAUTH_JWT_SECRET?: string;
  /** OIDC IdP (Auth0/Google): issuer URL, e.g. https://tenant.us.auth0.com */
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  /** Optional API audience for Auth0 */
  OIDC_AUDIENCE?: string;
  /** R2: raw MIME (.eml) after ingest from Resend */
  RAW_MIME?: R2Bucket;
  /** Max raw MIME size in bytes (default 15MB) */
  RAW_MIME_MAX_BYTES?: string;
  /** Max base64 body returned to agents via MCP (default 512KB) */
  RAW_MIME_AGENT_MAX_BYTES?: string;
  /** Max attachment size to cache in R2 at ingest (default 2MB) */
  ATTACHMENT_MAX_STORE_BYTES?: string;
  /** Verified From for outbound (Resend). Default: inbox address */
  OUTBOUND_FROM?: string;
  /** Workers AI — semantic search embeddings (optional) */
  AI?: Ai;
  /** Override embed model (default @cf/baai/bge-base-en-v1.5) */
  SEARCH_EMBED_MODEL?: string;
  /** LLM for structured extract (default @cf/meta/llama-3.1-8b-instruct) */
  EXTRACT_MODEL?: string;
  /** Workspace Agent LLM provider: deepseek (default), qwen, custom, xai, openai, openrouter, local, ollama */
  WORKSPACE_LLM_PROVIDER?: string;
  /** DeepSeek OpenAI-compatible API key */
  DEEPSEEK_API_KEY?: string;
  /** DeepSeek model override */
  DEEPSEEK_MODEL?: string;
  /** Qwen / DashScope OpenAI-compatible API key */
  QWEN_API_KEY?: string;
  /** DashScope API key alias for Qwen */
  DASHSCOPE_API_KEY?: string;
  /** Qwen model override */
  QWEN_MODEL?: string;
  /** OpenRouter API key (alias path for custom provider) */
  OPENROUTER_API_KEY?: string;
  /** OpenAI API key alias for custom provider (maps to LLM_* when unset) */
  OPENAI_API_KEY?: string;
  /** xAI / Grok API key */
  XAI_API_KEY?: string;
  /** xAI model override (default grok-3-mini) */
  XAI_MODEL?: string;
  /** Local OpenAI-compatible server (Ollama, LM Studio) — dev/self-host only */
  LOCAL_LLM_BASE_URL?: string;
  /** Local model name (Ollama tag, e.g. llama3.2) */
  LOCAL_LLM_MODEL?: string;
  /** Optional API key for local server (Ollama ignores; LM Studio may require) */
  LOCAL_LLM_API_KEY?: string;
  /** Ollama base URL alias (default http://127.0.0.1:11434/v1) */
  OLLAMA_BASE_URL?: string;
  /** Ollama model alias */
  OLLAMA_MODEL?: string;
  /** Custom OpenAI-compatible LLM API key */
  LLM_API_KEY?: string;
  /** Custom OpenAI-compatible base URL */
  LLM_BASE_URL?: string;
  /** Workspace Agent model override */
  LLM_MODEL?: string;
  /** Audit log retention in days (default 90, max 365) */
  AUDIT_RETENTION_DAYS?: string;
  /** Google OAuth client for Gmail read connector (P1) */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Aliases for Gmail OAuth */
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
}

export interface EmailQueueMessage {
  provider: "resend";
  emailId: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  /** Enterprise: fetch email body from team's Resend account */
  resendTeamId?: string;
}

export interface MessageNotifyPayload {
  id: string;
  inboxId: string;
  from: string;
  subject: string;
  otp: string | null;
  links: string[];
  primaryLink: string | null;
  receivedAt: string;
  verification?: {
    otp: string | null;
    links: string[];
    primaryLink: string | null;
    confidence?: "high" | "medium" | "low";
    matchedRule?: string | null;
    reason?: string;
    alternatives?: {
      otp: string[];
      links: string[];
    };
    from: string;
    subject: string;
    messageId: string;
    hasRaw?: boolean;
    rawUrl?: string;
  };
}
