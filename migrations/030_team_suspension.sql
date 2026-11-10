-- Abuse guard: a suspended team's keys stop working until an operator lifts it.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
