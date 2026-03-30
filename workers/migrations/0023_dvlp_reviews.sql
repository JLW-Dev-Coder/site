CREATE TABLE IF NOT EXISTS dvlp_reviews (
  review_id TEXT PRIMARY KEY,
  reviewer_name TEXT NOT NULL,
  reviewer_email TEXT,
  rating INTEGER NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);