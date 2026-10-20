CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  recovery_code_hash CHAR(64) NOT NULL UNIQUE,
  fingerprint_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_rumor_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_fingerprint_created_idx ON sessions (fingerprint_hash, created_at);

CREATE TABLE IF NOT EXISTS rumors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text VARCHAR(500) NOT NULL CHECK (char_length(text) BETWEEN 1 AND 500),
  category VARCHAR(20) NOT NULL CHECK (category IN ('academic','hostel','canteen','sports','events','other')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','debunked')),
  base_score NUMERIC(10,2) NOT NULL DEFAULT 50,
  upvote_count INTEGER NOT NULL DEFAULT 0 CHECK (upvote_count >= 0),
  flag_count INTEGER NOT NULL DEFAULT 0 CHECK (flag_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_boost_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rumors_category_created_idx ON rumors (category, created_at DESC);
CREATE INDEX IF NOT EXISTS rumors_status_idx ON rumors (status);
CREATE INDEX IF NOT EXISTS rumors_session_created_idx ON rumors (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rumor_id UUID NOT NULL REFERENCES rumors(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type VARCHAR(10) NOT NULL CHECK (type IN ('upvote','flag')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rumor_id, session_id, type)
);
CREATE INDEX IF NOT EXISTS votes_rumor_type_idx ON votes (rumor_id, type);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
