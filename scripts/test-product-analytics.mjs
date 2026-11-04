import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../public/product-analytics.js", import.meta.url), "utf8");
const landing = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const shell = fs.readFileSync(new URL("../public/site-shell.js", import.meta.url), "utf8");
const listeners = new Map();
const gtagCalls = [];
const dispatched = [];
const plain = (value) => JSON.parse(JSON.stringify(value));

class TestCustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

const window = {
  gtag: (...args) => gtagCalls.push(args),
  dispatchEvent: (event) => dispatched.push(event),
};
const document = {
  addEventListener: (type, listener) => listeners.set(type, listener),
};

vm.runInNewContext(source, { CustomEvent: TestCustomEvent, document, window });

assert.equal(typeof window.AgentsOSAnalytics?.track, "function");
assert.equal(typeof listeners.get("click"), "function");

listeners.get("click")({
  target: {
    closest: () => ({
      dataset: {
        analyticsEvent: "agentsos_agent_selected",
        analyticsAgent: "mail",
        analyticsSurface: "catalog",
        analyticsDestination: "console",
        analyticsApiKey: "must-not-leak",
      },
    }),
  },
});

assert.deepEqual(plain(gtagCalls), [[
  "event",
  "agentsos_agent_selected",
  { agent: "mail", surface: "catalog", destination: "console" },
]]);
assert.equal(dispatched[0].type, "agentsos:analytics");
assert.deepEqual(plain(dispatched[0].detail), {
  event: "agentsos_agent_selected",
  params: { agent: "mail", surface: "catalog", destination: "console" },
});

assert.equal(window.AgentsOSAnalytics.track("unknown_event", { agent: "mail" }), false);
assert.equal(gtagCalls.length, 1);

delete window.gtag;
assert.equal(window.AgentsOSAnalytics.track("agentsos_catalog_opened", { surface: "hero" }), true);
assert.equal(gtagCalls.length, 1);
assert.deepEqual(plain(dispatched[1].detail), {
  event: "agentsos_catalog_opened",
  params: { surface: "hero" },
});

const trackedLinks = [...landing.matchAll(/<a\b[^>]*data-analytics-event="[^"]+"[^>]*>/g)].map(
  (match) => match[0],
);
const attribute = (markup, name) => markup.match(new RegExp(`${name}="([^"]+)"`))?.[1];

assert.equal(trackedLinks.length, 14);
trackedLinks.forEach((markup) => {
  const eventName = attribute(markup, "data-analytics-event");
  assert.ok(
    [
      "agentsos_catalog_opened",
      "agentsos_agent_selected",
      "mailagent_key_requested",
      "mailagent_pilot_requested",
      "mailagent_pilot_submitted",
      "mailagent_pricing_viewed",
    ].includes(eventName),
    `unexpected event in landing markup: ${eventName}`,
  );
  assert.ok(attribute(markup, "data-analytics-surface"), "tracked links require a surface");
  if (eventName === "agentsos_agent_selected") {
    assert.ok(attribute(markup, "data-analytics-agent"), "agent selections require an agent");
    assert.ok(
      attribute(markup, "data-analytics-destination"),
      "agent selections require a destination",
    );
  }
});
assert.match(shell, /mailagent_key_requested[^`]+data-analytics-surface="navigation"/);
assert.equal(window.AgentsOSAnalytics.track("mailagent_pilot_requested", { surface: "pricing" }), true);
assert.equal(window.AgentsOSAnalytics.track("mailagent_pilot_submitted", { surface: "pilot_form" }), true);
assert.equal(window.AgentsOSAnalytics.track("mailagent_pricing_viewed", { surface: "pricing" }), true);
assert.match(landing, /data-analytics-view="mailagent_pricing_viewed"/);
assert.ok(
  trackedLinks.some((markup) => attribute(markup, "data-analytics-event") === "mailagent_key_requested"),
  "landing must track API key requests",
);
assert.ok(
  trackedLinks.some((markup) => attribute(markup, "data-analytics-event") === "mailagent_pilot_requested"),
  "landing must track pilot requests",
);

console.log("product analytics: ok");
