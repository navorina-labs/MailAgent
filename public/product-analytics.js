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

  window.AgentsOSAnalytics = Object.freeze({ track });
  document.addEventListener("click", handleClick);
})();

