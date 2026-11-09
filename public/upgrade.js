/** Pro billing by email link: POST /v1/upgrade/request, then /v1/upgrade/confirm from the link (#t=…). */
(function () {
  const form = document.getElementById("upgrade-form");
  if (!form) return;

  const api = form.dataset.api;
  const status = document.getElementById("upgrade-status");
  const email = form.elements.namedItem("email");
  const buttons = form.querySelectorAll("button[type=submit]");
  const off = document.getElementById("upgrade-off");
  const CONTACT = "hello@webmailagent.com";

  const ERRORS = {
    invalid_email: "Enter a valid email.",
    rate_limit_exceeded: "Too many requests. Try again in an hour.",
    invalid_or_expired_token: "This link has expired or was already used. Request a new one below.",
    already_pro: "This account is already on Pro. Use Manage subscription to change it.",
    no_subscription: "No paid subscription on this account yet. Use Upgrade to Pro.",
    billing_unavailable: "Card payments are not enabled yet. Write to " + CONTACT + ".",
  };
  const fallback = "Something went wrong. Write to " + CONTACT + ".";
  const RETURNS = {
    success: "Payment received. Your key moves to Pro within a minute.",
    cancel: "Checkout canceled. Nothing was charged.",
    portal: "Subscription settings saved.",
  };

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function setBusy(busy) {
    buttons.forEach((b) => (b.disabled = busy));
  }

  async function post(path, body) {
    const res = await fetch(api + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  function showOff() {
    form.hidden = true;
    off.hidden = false;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const action = event.submitter?.value === "portal" ? "portal" : "checkout";
    const value = String(email.value || "").trim();
    if (!value || !email.checkValidity()) {
      email.setAttribute("aria-invalid", "true");
      setStatus(ERRORS.invalid_email, "error");
      email.focus();
      return;
    }
    email.removeAttribute("aria-invalid");
    setBusy(true);
    setStatus("Sending", null);
    try {
      const { status: code, json } = await post("/v1/upgrade/request", {
        email: value,
        action,
        website: String(form.elements.namedItem("website").value || ""),
      });
      if (code === 202) {
        setStatus("Check " + value + ". The link works once, for 30 minutes.", "success");
        return;
      }
      if (json.error === "billing_unavailable") return showOff();
      if (json.field === "email") email.setAttribute("aria-invalid", "true");
      setStatus(ERRORS[json.error] || fallback, "error");
    } catch {
      setStatus(fallback, "error");
    } finally {
      setBusy(false);
    }
  });

  async function confirm(token) {
    history.replaceState(null, "", location.pathname + location.search);
    setStatus("Opening Stripe", null);
    setBusy(true);
    try {
      const { status: code, json } = await post("/v1/upgrade/confirm", { token });
      if (code === 200 && json.url) {
        if (json.action === "checkout") {
          window.AgentsOSAnalytics?.track("mailagent_checkout_started", { surface: "upgrade" });
        }
        location.assign(json.url);
        return;
      }
      if (json.error === "billing_unavailable") return showOff();
      setStatus(ERRORS[json.error] || fallback, "error");
    } catch {
      setStatus(fallback, "error");
    } finally {
      setBusy(false);
    }
  }

  const back = new URLSearchParams(location.search).get("billing");
  if (RETURNS[back]) {
    setStatus(RETURNS[back], back === "cancel" ? null : "success");
    status.focus();
  }

  const token = new URLSearchParams(location.hash.slice(1)).get("t");
  if (token) {
    confirm(token);
  } else {
    fetch(api + "/v1/upgrade/config")
      .then((res) => res.json())
      .then((cfg) => {
        if (!cfg.billing) showOff();
      })
      .catch(() => {});
  }
})();
