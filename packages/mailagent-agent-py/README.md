# mailagent-agent (Python)

Minimal Python SDK for [MailAgent](https://agents.navorina.ai) agent verify flows — parity with `@mailagent/agent` core methods.

```bash
pip install mailagent-agent
```

```python
from mailagent import MailAgent

client = MailAgent("https://mail-api.navorina.ai", "ma_…")
result = client.verify_signup(service="github", timeout_seconds=90, delete_after=True)
print(result.get("agent", {}).get("primaryAction"))
```

## Methods

- `verify_signup(**options)` — `POST /v1/agent/verify`
- `get_profile()` — `GET /v1/me`
- `create_inbox(**options)` / `delete_inbox(id)`
- `list_messages(inbox_id, subject_contains=…)`
- `simulate_message(inbox_id, scenario="otp", …)`
- `diagnose_inbox(inbox_id, …)`
- `list_runs(run_id=…, label=…)`

Source: `agents-os/agents/mail-agent/packages/mailagent-agent-py` in [Navorina](https://github.com/navorinaai/navorina).
