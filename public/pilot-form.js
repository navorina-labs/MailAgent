/** Landing pilot form: posts JSON to POST /v1/pilot-requests (see src/routes/pilot.ts). */
(function () {
  const form = document.getElementById("pilot-form");
  if (!form) return;

  const status = document.getElementById("pilot-status");
  const submit = document.getElementById("pilot-submit");
  const email = form.elements.namedItem("email");
  const url = form.elements.namedItem("productUrl");
  const CONTACT = "hello@webmailagent.com";

  const ERRORS = {
    invalid_email: "Enter a valid work email.",
    invalid_product_url: "Product URL must start with http:// or https://.",
    rate_limit_exceeded: "Too many requests. Try again in an hour or email " + CONTACT + ".",
  };

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.toggle("is-error", kind === "error");
    status.classList.toggle("is-success", kind === "success");
  }

  function markInvalid(field) {
    [email, url].forEach((input) => input.removeAttribute("aria-invalid"));
    if (field === "email") email.setAttribute("aria-invalid", "true");
    if (field === "productUrl") url.setAttribute("aria-invalid", "true");
    (field === "productUrl" ? url : email).focus();
  }

  function payload() {
    const data = new FormData(form);
    return {
      email: String(data.get("email") || "").trim(),
      company: String(data.get("company") || "").trim(),
      productUrl: String(data.get("productUrl") || "").trim(),
      runner: String(data.get("runner") || "").trim(),
      flows: data.getAll("flows").map(String),
      website: String(data.get("website") || ""),
    };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = payload();

    if (!email.checkValidity() || !body.email) {
      setStatus(ERRORS.invalid_email, "error");
      markInvalid("email");
      return;
    }
    if (body.productUrl && !/^https?:\/\/\S+$/i.test(body.productUrl)) {
      setStatus(ERRORS.invalid_product_url, "error");
      markInvalid("productUrl");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Sending";
    setStatus("", null);

    try {
      const res = await fetch(form.action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 202) {
        form.reset();
        setStatus("Request sent. We will reply to " + body.email + ".", "success");
        window.AgentsOSAnalytics?.track("mailagent_pilot_submitted", { surface: "pilot_form" });
        return;
      }
      setStatus(ERRORS[json.error] || "Could not send. Email " + CONTACT + ".", "error");
      if (json.field) markInvalid(json.field);
    } catch {
      setStatus("Could not send. Email " + CONTACT + ".", "error");
    } finally {
      submit.disabled = false;
      submit.textContent = "Request a pilot";
    }
  });
})();
