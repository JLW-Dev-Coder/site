CREATE TABLE IF NOT EXISTS dvlp_jobs (
  job_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  skills_required TEXT,
  budget_min INTEGER,
  budget_max INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  posted_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);