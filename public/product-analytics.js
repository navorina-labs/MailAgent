/**
 * Privacy-bounded marketing funnel events for the Mail Agent landing.
 * Operational Mail Agent data belongs in authenticated audit records, not here.
 */
(function () {
  const EVENTS = new Set([
    "agentsos_catalog_opened",
    "agentsos_agent_selected",
    "mailagent_key_requested",
    "mailagent_pilot_requested",
    "mailagent_pilot_submitted",
    "mailagent_pricing_viewed",
    "mailagent_key_email_sent",
    "mailagent_key_issued",
    "mailagent_checkout_started",
  ]);
  const PARAMS = ["agent", "surface", "destination"];

  function track(eventName, params = {}) {
    if (!EVENTS.has(eventName)) return false;

    const safeParams = {};
    PARAMS.forEach((key) => {
      const value = params[key];
      if (typeof value === "string" && value.length > 0 && value.length <= 64) {
        safeParams[key] = value;
      }
    });

    if (typeof window.gtag === "function") {
      window.gtag("event", eventName, safeParams);
    }
    window.dispatchEvent(
      new CustomEvent("agentsos:analytics", {
        detail: { event: eventName, params: safeParams },
      }),
    );
    return true;
  }

  function handleClick(event) {
    const target = event.target?.closest?.("[data-analytics-event]");
    if (!target) return;

    track(target.dataset.analyticsEvent, {
      agent: target.dataset.analyticsAgent,
      surface: target.dataset.analyticsSurface,
      destination: target.dataset.analyticsDestination,
    });
  }

  /** Fire a view event once when an element with data-analytics-view scrolls into view. */
  function observeViews() {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = document.querySelectorAll?.("[data-analytics-view]") ?? [];
    if (!targets.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          track(entry.target.dataset.analyticsView, { surface: entry.target.dataset.analyticsSurface });
        });
      },
      { threshold: 0.4 },
    );
    targets.forEach((target) => observer.observe(target));
  }

  window.AgentsOSAnalytics = Object.freeze({ track });
  document.addEventListener("click", handleClick);
  if (document.readyState === "loading") {
    document.addEventListener?.("DOMContentLoaded", observeViews);
  } else {
    observeViews();
  }
})();

