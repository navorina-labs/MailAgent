/** Self-serve Free key: POST /v1/keys/request, then /v1/keys/confirm from the emailed link (#t=…). */
(function () {
  const form = document.getElementById("key-form");
  if (!form) return;

  const api = form.dataset.api;
  const status = document.getElementById("key-status");
  const submit = document.getElementById("key-submit");
  const email = form.elements.namedItem("email");
  const result = document.getElementById("key-result");
  const CONTACT = "hello@webmailagent.com";

  const ERRORS = {
    invalid_email: "Enter a valid work email.",
    inbox_domain_not_allowed: "Use your own work email, not a Mail Agent inbox.",
    disposable_email: "Disposable email addresses are not accepted.",
    email_not_deliverable: "This domain does not accept email. Check the address.",
    rate_limit_exceeded: "Too many requests. Try again in an hour.",
    invalid_or_expired_token: "This link has expired or was already used. Request a new one below.",
    key_limit_reached: "This email already has the maximum number of keys. Write to " + CONTACT + ".",
  };
  const fallback = "Something went wrong. Write to " + CONTACT + ".";
  let sent = false;

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  async function post(path, body) {
    const res = await fetch(api + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

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
    submit.disabled = true;
    submit.textContent = "Sending";
    setStatus("", null);
    try {
      const { status: code, json } = await post("/v1/keys/request", {
        email: value,
        website: String(form.elements.namedItem("website").value || ""),
      });
      if (code === 202) {
        setStatus("Check " + value + ". The link works once, for 30 minutes.", "success");
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
      submit.textContent = sent ? "Send again" : "Email me the link";
    }
  });

  async function confirm(token) {
    // Drop the token from the address bar and history right away.
    history.replaceState(null, "", location.pathname + location.search);
    setStatus("Confirming your email", null);
    submit.disabled = true;
    try {
      const { status: code, json } = await post("/v1/keys/confirm", { token });
      if (code === 201 && json.apiKey) {
        form.hidden = true;
        result.hidden = false;
        document.getElementById("key-value").textContent = json.apiKey;
        document.getElementById("key-mcp").textContent =
          "claude mcp add mailagent \\\n  -e MAILAGENT_API_KEY=" + json.apiKey +
          " \\\n  -- npx -y -p @mailagent/mcp@latest mailagent-mcp";
        document.getElementById("key-result-title").focus();
        window.AgentsOSAnalytics?.track("mailagent_key_issued", { surface: "get_key" });
        return;
      }
      setStatus(ERRORS[json.error] || fallback, "error");
    } catch {
      setStatus(fallback, "error");
    } finally {
      submit.disabled = false;
    }
  }

  const token = new URLSearchParams(location.hash.slice(1)).get("t");
  if (token) confirm(token);
})();
