/** Pilot request from the landing form: validation and the email sent to the team. */

export const PILOT_FLOWS = ["signup", "login", "password_reset", "invite", "2fa"] as const;
export type PilotFlow = (typeof PILOT_FLOWS)[number];

export type PilotRequest = {
  email: string;
  name: string;
  company: string;
  productUrl: string;
  flows: PilotFlow[];
  runner: string;
  message: string;
};

export type PilotValidation =
  | { ok: true; value: PilotRequest; spam: boolean }
  | { ok: false; error: string; field?: string };

const LIMITS = { email: 254, name: 100, company: 120, productUrl: 300, runner: 120, message: 1000 };
const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
  return trimmed.length > max ? null : trimmed;
}

export function validatePilotRequest(body: unknown): PilotValidation {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  // Honeypot: real users never see or fill the "website" field.
  const spam = typeof b.website === "string" && b.website.trim().length > 0;

  const fields: Record<string, string> = {};
  for (const key of ["email", "name", "company", "productUrl", "runner", "message"] as const) {
    const value = text(b[key], LIMITS[key]);
    if (value === null) return { ok: false, error: "field_too_long", field: key };
    fields[key] = value;
  }

  const email = fields.email.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: "invalid_email", field: "email" };

  if (fields.productUrl && !/^https?:\/\/\S+$/i.test(fields.productUrl)) {
    return { ok: false, error: "invalid_product_url", field: "productUrl" };
  }

  const rawFlows = Array.isArray(b.flows) ? b.flows : b.flows === undefined ? [] : null;
  if (rawFlows === null || rawFlows.length > PILOT_FLOWS.length) {
    return { ok: false, error: "invalid_flows", field: "flows" };
  }
  const flows: PilotFlow[] = [];
  for (const flow of rawFlows) {
    if (!PILOT_FLOWS.includes(flow as PilotFlow)) return { ok: false, error: "invalid_flows", field: "flows" };
    if (!flows.includes(flow as PilotFlow)) flows.push(flow as PilotFlow);
  }

  return {
    ok: true,
    spam,
    value: {
      email,
      name: fields.name,
      company: fields.company,
      productUrl: fields.productUrl,
      flows,
      runner: fields.runner,
      message: fields.message,
    },
  };
}

export function pilotEmail(req: PilotRequest): { subject: string; text: string } {
  const who = req.company || req.name || req.email;
  const lines = [
    `Email: ${req.email}`,
    `Name: ${req.name || "-"}`,
    `Company: ${req.company || "-"}`,
    `Product URL: ${req.productUrl || "-"}`,
    `Flows: ${req.flows.length ? req.flows.join(", ") : "-"}`,
    `Agent or test runner: ${req.runner || "-"}`,
    "",
    req.message || "(no message)",
    "",
    "Sent from the pilot form on webmailagent.com. Reply to answer the sender.",
  ];
  return { subject: `Mail Agent pilot request: ${who}`.slice(0, 150), text: lines.join("\n") };
}
