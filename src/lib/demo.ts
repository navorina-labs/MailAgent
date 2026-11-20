/**
 * Keyless demo: a sample email goes through the same extraction as real mail.
 * No inbox is created and nothing is stored.
 */
import { extractLinks, extractOtp, primaryLink } from "../services/extract";
import { extractHtmlActions } from "../services/html-actions";
import { buildVerificationMetadata } from "../services/message-verify";
import { buildPrimaryAction } from "./agent-recipes";
import { GET_KEY_URL } from "./auth-error";

export type DemoScenarioId = "otp" | "magic_link" | "password_reset" | "invite";

type DemoFixture = { from: string; subject: string; text: string; html: string | null };

const FIXTURES: Record<DemoScenarioId, (n: string) => DemoFixture> = {
  otp: (n) => ({
    from: "Acme <no-reply@acme.dev>",
    subject: "Your Acme verification code",
    text: `Hi,\n\nYour verification code is ${n}. It expires in 10 minutes.\n\nIf you did not sign up, ignore this email.\nUnsubscribe: https://acme.dev/unsubscribe`,
    html: null,
  }),
  magic_link: (n) => ({
    from: "Acme <no-reply@acme.dev>",
    subject: "Confirm your Acme account",
    text: `Confirm your email to finish signing up: https://staging.acme.dev/verify?token=demo_${n}\n\nPrivacy: https://acme.dev/privacy`,
    html: `<p>Confirm your email to finish signing up.</p><a href="https://staging.acme.dev/verify?token=demo_${n}">Confirm email</a><p><a href="https://acme.dev/privacy">Privacy</a></p>`,
  }),
  password_reset: (n) => ({
    from: "Acme <security@acme.dev>",
    subject: "Reset your Acme password",
    text: `Someone asked to reset your password. Reset it here: https://staging.acme.dev/password-reset?token=demo_${n}\n\nThe link works for 30 minutes.`,
    html: `<p>Someone asked to reset your password.</p><a href="https://staging.acme.dev/password-reset?token=demo_${n}">Reset password</a>`,
  }),
  invite: (n) => ({
    from: "Acme <team@acme.dev>",
    subject: "Sam invited you to the Acme workspace",
    text: `Sam invited you to the Acme workspace. Accept the invite: https://staging.acme.dev/invite/demo_${n}`,
    html: null,
  }),
};

export const DEMO_SCENARIOS = Object.keys(FIXTURES) as DemoScenarioId[];

export function resolveDemoScenario(id: unknown): DemoScenarioId | null {
  if (id === undefined || id === null || id === "") return "otp";
  const key = String(id).trim().toLowerCase();
  return (DEMO_SCENARIOS as string[]).includes(key) ? (key as DemoScenarioId) : null;
}

/** `rand` gives 6 digits and an address suffix; tests pass a fixed one. */
export function buildDemoRun(
  scenario: DemoScenarioId,
  opts: { inboxDomain?: string; rand?: () => number } = {}
) {
  const rand = opts.rand ?? Math.random;
  const code = String(100000 + Math.floor(rand() * 900000));
  const suffix = Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
  const fixture = FIXTURES[scenario](code);

  const source = fixture.text + (fixture.html ? "\n" + fixture.html : "");
  const otp = scenario === "otp" ? extractOtp(fixture.text) : null;
  const links = extractLinks(source);
  const primary = primaryLink(links);
  const actions = extractHtmlActions({ html: fixture.html, text: fixture.text, links });
  const metadata = buildVerificationMetadata(otp, links, primary);

  return {
    demo: true as const,
    note: "Sample email from a made-up app. No inbox was created and nothing is stored.",
    scenario,
    scenarios: DEMO_SCENARIOS,
    inbox: { address: `demo-${suffix}@${opts.inboxDomain || "inbox.webmailagent.com"}`, created: false },
    message: { from: fixture.from, subject: fixture.subject, text: fixture.text },
    verification: {
      otp,
      primaryLink: primary,
      links,
      primaryButton: actions.primaryButton,
      ...metadata,
    },
    agent: {
      primaryAction: buildPrimaryAction({ otp, primaryLink: primary, links, primaryButton: actions.primaryButton }),
    },
    getKey: GET_KEY_URL,
  };
}
