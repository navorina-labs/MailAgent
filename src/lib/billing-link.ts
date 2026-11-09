/** Email-link billing: the browser never needs the API key to upgrade or manage Pro. */

export type BillingAction = "checkout" | "portal";

export const PRO_PRICE_USD = 29;

export function parseBillingAction(raw: unknown): BillingAction | null {
  return raw === "checkout" || raw === "portal" ? raw : null;
}

export function billingLinkEmail(action: BillingAction, link: string): { subject: string; text: string } {
  const what =
    action === "checkout"
      ? `Open this link to upgrade your Mail Agent account to Pro ($${PRO_PRICE_USD}/month):`
      : "Open this link to manage your Mail Agent subscription (cancel, change card, invoices):";
  return {
    subject: action === "checkout" ? "Upgrade Mail Agent to Pro" : "Manage your Mail Agent subscription",
    text: [
      what,
      "",
      link,
      "",
      "The link works once and expires in 30 minutes.",
      "If you did not ask for it, ignore this email.",
    ].join("\n"),
  };
}

export function noAccountEmail(getKeyUrl: string): { subject: string; text: string } {
  return {
    subject: "No Mail Agent account for this email",
    text: [
      "Someone asked for a Mail Agent billing link for this address, but no API key is registered to it.",
      "",
      `Get a free key first: ${getKeyUrl}`,
      "",
      "If your key was issued manually, write to hello@webmailagent.com.",
      "If you did not ask for this, ignore this email.",
    ].join("\n"),
  };
}
