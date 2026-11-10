/**
 * Self-serve keys.
 * Get:     POST /v1/keys/request, then /v1/keys/confirm from the emailed link (#t=...).
 * Replace: POST /v1/keys/rotate/request, then /v1/keys/rotate/confirm from the emailed link (#r=...).
 */
(function () {
  const form = document.getElementById("key-form");
  if (!form) return;

  const api = form.dataset.api;
  const status = document.getElementById("key-status");
  const submit = document.getElementById("key-submit");
  const email = form.elements.namedItem("email");
  const result = document.getElementById("key-result");
  const modeBtn = document.getElementById("key-mode");
  const CONTACT = "hello@webmailagent.com";

  const MODES = {
    get: {
      path: "/v1/keys/request",
      submit: "Email me the link",
      toggle: "Lost or leaked key? Replace it",
      sent: (v) => "Check " + v + ". The link works once, for 30 minutes.",
    },
    replace: {
      path: "/v1/keys/rotate/request",
      submit: "Email me a replace link",
      toggle: "Back to getting a new key",
      sent: (v) =>
        "Check " + v + ". Opening the link revokes your current keys and shows a new one. It works once, for 30 minutes.",
    },
  };

  const ERRORS = {
    invalid_email: "Enter a valid work email.",
    inbox_domain_not_allowed: "Use your own work email, not a Mail Agent inbox.",
    disposable_email: "Disposable email addresses are not accepted.",
    email_not_deliverable: "This domain does not accept email. Check the address.",
    rate_limit_exceeded: "Too many requests. Try again in an hour.",
    invalid_or_expired_token: "This link has expired or was already used. Request a new one below.",
    key_limit_reached: "This email already has the maximum number of keys. Replace them below, or write to " + CONTACT + ".",
  };
  const fallback = "Something went wrong. Write to " + CONTACT + ".";

  let mode = new URLSearchParams(location.search).has("replace") ? "replace" : "get";
  let sent = false;

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function applyMode() {
    const m = MODES[mode];
    submit.textContent = m.submit;
    if (modeBtn) modeBtn.textContent = m.toggle;
    form.dataset.mode = mode;
    sent = false;
  }

  async function post(path, body) {
    const res = await fetch(api + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  modeBtn?.addEventListener("click", () => {
    mode = mode === "get" ? "replace" : "get";
    applyMode();
    setStatus("", null);
    email.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = String(email.value || "").trim();
    if (!value || !email.checkValidity()) {
      email.setAttribute("aria-invalid", "true");
      setStatus(ERRORS.invalid_email, "error");
      email.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    const m = MODES[mode];
    submit.disabled = true;
    submit.textContent = "Sending";
    setStatus("", null);
    try {
      const { status: code, json } = await post(m.path, {
        email: value,
        website: String(form.elements.namedItem("website").value || ""),
      });
      if (code === 202) {
        setStatus(m.sent(value), "success");
        window.AgentsOSAnalytics?.track("mailagent_key_email_sent", { surface: "get_key" });
        sent = true;
        return;
      }
      if (json.field === "email") email.setAttribute("aria-invalid", "true");
      setStatus(ERRORS[json.error] || fallback, "error");
    } catch {
      setStatus(fallback, "error");
    } finally {
      submit.disabled = false;
      submit.textContent = sent ? "Send again" : m.submit;
    }
  });

  function showKey(apiKey, title, note) {
    form.hidden = true;
    if (modeBtn) modeBtn.hidden = true;
    result.hidden = false;
    document.getElementById("key-result-title").textContent = title;
    const noteEl = document.getElementById("key-result-note");
    noteEl.textContent = note || "";
    noteEl.hidden = !note;
    document.getElementById("key-value").textContent = apiKey;
    document.getElementById("key-mcp").textContent =
      "claude mcp add mailagent \\\n  -e MAILAGENT_API_KEY=" + apiKey +
      " \\\n  -- npx -y -p @mailagent/mcp@latest mailagent-mcp";
    document.getElementById("key-result-title").focus();
  }

  async function confirm(token, replace) {
    // Drop the token from the address bar and history right away.
    history.replaceState(null, "", location.pathname + location.search);
    setStatus(replace ? "Replacing your key" : "Confirming your email", null);
    submit.disabled = true;
    try {
      const path = replace ? "/v1/keys/rotate/confirm" : "/v1/keys/confirm";
      const { status: code, json } = await post(path, { token });
      if (code === 201 && json.apiKey) {
        if (replace) {
          showKey(
            json.apiKey,
            "Your new API key",
            "Old keys revoked: " + (json.revokedKeys || 0) + ". Inboxes moved to the new key: " + (json.movedInboxes || 0) +
              ". Update the key in your CI secrets and agent settings."
          );
          window.AgentsOSAnalytics?.track("mailagent_key_rotated", { surface: "get_key" });
        } else {
          showKey(json.apiKey, "Your API key", "");
          window.AgentsOSAnalytics?.track("mailagent_key_issued", { surface: "get_key" });
        }
        return;
      }
      setStatus(ERRORS[json.error] || fallback, "error");
    } catch {
      setStatus(fallback, "error");
    } finally {
      submit.disabled = false;
    }
  }

  applyMode();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("t")) confirm(hash.get("t"), false);
  else if (hash.get("r")) {
    mode = "replace";
    applyMode();
    confirm(hash.get("r"), true);
  }
})();
