-- TTMP Reports table for storing transcript analysis reports
-- Used by TTMP transcript dashboard for report history and retrieval

CREATE TABLE IF NOT EXISTS ttmp_reports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  report_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  report_url TEXT,
  event_id TEXT,
  tokens_used INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_ttmp_reports_account
  ON ttmp_reports(account_id, created_at DESC);