CREATE TABLE IF NOT EXISTS recovery_attempts (
  fingerprint_hash CHAR(64) PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);
