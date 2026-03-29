-- Migration 0016: tool_sessions and transcript_jobs
-- tool_sessions: lightweight index of TTTMP tool executions (canonical in R2 tttmp_tool_sessions/)
-- transcript_jobs: index of TTMP transcript parse jobs (canonical in R2 ttmp_transcript_jobs/)

CREATE TABLE IF NOT EXISTS tool_sessions (
  session_id    TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  tool          TEXT NOT NULL,   -- 'form_2848' | 'form_8821'
  token_type    TEXT NOT NULL,   -- 'tax_game'
  tokens_debited INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'completed',
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_sessions_account ON tool_sessions (account_id);

CREATE TABLE IF NOT EXISTS transcript_jobs (
  job_id        TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL,
  transcript_type TEXT NOT NULL, -- 'account' | 'record_of_account' | 'return' | 'wage_and_income'
  tax_year      INTEGER,
  tokens_debited INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'completed',
  result_key    TEXT,            -- R2 key for result object
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_transcript_jobs_account ON transcript_jobs (account_id);
