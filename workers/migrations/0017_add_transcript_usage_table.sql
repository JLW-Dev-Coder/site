CREATE TABLE IF NOT EXISTS tttmp_transcript_usage (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL,
  transcript_hash TEXT NOT NULL,
  executed_at INTEGER NOT NULL,
  tokens_deducted INTEGER NOT NULL DEFAULT 1,
  result_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tttmp_transcript_usage_account ON tttmp_transcript_usage(account_id);
CREATE INDEX IF NOT EXISTS idx_tttmp_transcript_usage_dedupe ON tttmp_transcript_usage(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_tttmp_transcript_usage_executed ON tttmp_transcript_usage(executed_at);
