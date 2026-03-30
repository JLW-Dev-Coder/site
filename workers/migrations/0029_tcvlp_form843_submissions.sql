CREATE TABLE IF NOT EXISTS tcvlp_form843_submissions (
  submission_id TEXT PRIMARY KEY,
  pro_id TEXT NOT NULL,
  taxpayer_name TEXT NOT NULL,
  taxpayer_email TEXT,
  tax_year TEXT NOT NULL,
  penalty_type TEXT NOT NULL,
  penalty_amount TEXT,
  state TEXT NOT NULL,
  mailing_address TEXT NOT NULL,
  transcript_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT
);