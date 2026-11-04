# Mail Agent landing analytics

The landing (`public/index.html`, original AgentsOS styles from `styles.css`) measures whether a visitor asks for an API key, asks to join the pilot, or moves on to docs, the console or self-hosting. Event names keep the `agentsos_` prefix where they predate the Mail Agent landing.

## Events

| Event | When it fires | Parameters |
| --- | --- | --- |
| `mailagent_key_requested` | A visitor opens the "Get API key" email (navigation, hero, pricing, final CTA) | `surface` |
| `mailagent_pilot_requested` | A visitor opens the Pro access or pilot email (pricing, final CTA) | `surface` |
| `agentsos_agent_selected` | A visitor follows a link to Mail Agent docs, the hosted console, or the self-host guide | `agent`, `surface`, `destination` (`documentation`, `console`, `self_host`) |
| `agentsos_catalog_opened` | Legacy AgentsOS catalog CTA; still accepted, not used on the current landing | `surface` |

Allowed parameter values are short, controlled strings declared in the page markup. The shared shell ignores unknown event names and unknown parameters.

## Privacy boundary

Marketing events are sent only when the page already exposes the Google Analytics `gtag` function. The dashboard does not load the marketing analytics tag.

Never add these values to marketing analytics:

- API keys or key hints;
- inbox ids or addresses;
- email subjects, bodies, attachments, OTPs, or links;
- team, domain, or billing identifiers;
- API errors or response payloads.

Hosted workflow success, failure, recovery, and retention should be measured from the existing authenticated audit and usage records, not by copying operational data into browser analytics.

## Funnel

Use the events to calculate:

1. landing view to `mailagent_key_requested`;
2. landing view to `mailagent_pilot_requested`;
3. `agentsos_agent_selected` destination by surface.

Key and pilot requests open a prefilled email to `hello@webmailagent.com`. A click is intent, not a sent request: count real requests from the inbox.

Do not treat a CTA click as a successful run. A successful Mail Agent workflow requires server-side evidence such as an inbox lifecycle or completed agent run.

## Local verification

1. Serve `public/` locally and open the landing page.
2. Listen for the `agentsos:analytics` browser event.
3. Select the hero "Get a free API key" CTA and the hero docs link.
4. Confirm the event name and controlled parameters.
5. Confirm unknown events return `false` through `window.AgentsOSAnalytics.track(...)`.

