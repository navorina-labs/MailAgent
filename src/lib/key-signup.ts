/** Self-serve Free API key: email rules, tokens and the confirmation email. */

export const SIGNUP_TOKEN_TTL_SECONDS = 30 * 60;

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

export function normalizeSignupEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * Our own inbox domains must not sign up: an agent could otherwise mint
 * unlimited keys by confirming through Mail Agent inboxes.
 */
export function isOwnInboxDomain(email: string, inboxDomain: string | undefined): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const own = ["webmailagent.com", "navorina.ai"];
  const inbox = inboxDomain?.trim().toLowerCase();
  if (inbox) own.push(inbox);
  return own.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function newSignupToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `ma_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function confirmationEmail(link: string): { subject: string; text: string } {
  return {
    subject: "Confirm your Mail Agent API key",
    text: [
      "Open this link to get your free Mail Agent API key:",
      "",
      link,
      "",
      "The link works once and expires in 30 minutes.",
      "If you did not ask for a key, ignore this email.",
    ].join("\n"),
  };
}

export function rotationEmail(link: string): { subject: string; text: string } {
  return {
    subject: "Replace your Mail Agent API key",
    text: [
      "Open this link to replace your Mail Agent API key:",
      "",
      link,
      "",
      "All current keys for this email stop working right away. Your inboxes move to the new key.",
      "The link works once and expires in 30 minutes.",
      "If you did not ask for this, ignore this email. Nothing changes until the link is opened.",
    ].join("\n"),
  };
}

export function noKeyEmail(getKeyUrl: string): { subject: string; text: string } {
  return {
    subject: "No Mail Agent key for this email",
    text: [
      "Someone asked to replace a Mail Agent API key for this address, but no key is registered to it.",
      "",
      `Get a free key: ${getKeyUrl}`,
      "",
      "If you did not ask for this, ignore this email.",
    ].join("\n"),
  };
}
