-- Monthly email cap per team (Free 500, Pro 5000). One row per team per UTC month.
-- Counts inbound and outbound emails that go through Resend.

CREATE TABLE IF NOT EXISTS team_email_usage (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, month)
);
