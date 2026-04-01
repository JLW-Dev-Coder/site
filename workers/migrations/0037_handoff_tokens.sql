CREATE TABLE IF NOT EXISTS handoff_tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_handoff_tokens_expires_at ON handoff_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_handoff_tokens_session_id ON handoff_tokens(session_id);