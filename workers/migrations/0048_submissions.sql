-- Unified submissions table for all form data across all 8 VLP platforms
CREATE TABLE IF NOT EXISTS submissions (
  submission_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  form_type TEXT NOT NULL,
  submitter_name TEXT,
  submitter_email TEXT,
  submitter_firm TEXT,
  submitter_credential TEXT,
  anonymous INTEGER DEFAULT 0,
  public INTEGER DEFAULT 0,
  consent_publish INTEGER DEFAULT 0,
  consent_marketing INTEGER DEFAULT 0,
  rating INTEGER,
  prospect_slug TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_platform ON submissions(platform);
CREATE INDEX IF NOT EXISTS idx_submissions_form_type ON submissions(form_type);
CREATE INDEX IF NOT EXISTS idx_submissions_public ON submissions(public);
CREATE INDEX IF NOT EXISTS idx_submissions_email ON submissions(submitter_email);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);
