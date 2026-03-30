CREATE TABLE IF NOT EXISTS dvlp_developers (
  developer_id TEXT PRIMARY KEY,
  account_id TEXT,
  ref_number TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  skills TEXT,
  experience_years INTEGER,
  hourly_rate INTEGER,
  availability TEXT,
  publish_profile INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TEXT NOT NULL,
  updated_at TEXT
);