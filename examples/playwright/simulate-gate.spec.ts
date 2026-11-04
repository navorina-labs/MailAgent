/**
 * CI Playwright gate: create → simulate → wait → extract (MAILAGENT_API_KEY only).
 */
import { test, expect } from "@playwright/test";

const base = (process.env.MAILAGENT_API_URL ?? "https://mail-api.navorina.ai").replace(
  /\/$/,
  ""
);
const apiKey = process.env.MAILAGENT_API_KEY ?? process.env.API_KEY;

test.describe("mailagent simulate gate", () => {
  test.beforeAll(() => {
    if (!apiKey) {
      throw new Error("MAILAGENT_API_KEY is required for simulate-gate");
    }
  });

  test("simulate OTP pipeline on prod API", async () => {
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const label = `pw-gate-${Date.now()}`;
    const expectedOtp = "882441";

    const created = await fetch(`${base}/v1/inboxes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ label, ttlMinutes: 15, service: "auth0" }),
    });
    const inbox = (await created.json()) as { id?: string };
    expect(created.ok, JSON.stringify(inbox)).toBeTruthy();
    expect(inbox.id).toBeTruthy();

    const sim = await fetch(`${base}/v1/inboxes/${inbox.id}/simulate`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        otp: expectedOtp,
        from: "noreply@auth0.com",
        subject: "Playwright simulate gate",
      }),
    });
    expect(sim.ok, await sim.text()).toBeTruthy();

    const wait = await fetch(
      `${base}/v1/inboxes/${inbox.id}/wait?timeout=30&subjectContains=Playwright`,
      { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
    );
    const waited = (await wait.json()) as { message?: { id?: string } };
    expect(wait.ok, JSON.stringify(waited)).toBeTruthy();
    expect(waited.message?.id).toBeTruthy();

    const extract = await fetch(`${base}/v1/inboxes/${inbox.id}/extract`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const verification = (await extract.json()) as { otp?: string };
    expect(extract.ok, JSON.stringify(verification)).toBeTruthy();
    expect(verification.otp).toBe(expectedOtp);

    await fetch(`${base}/v1/inboxes/${inbox.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    }).catch(() => {});
  });
});
