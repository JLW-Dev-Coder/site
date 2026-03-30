CREATE TABLE IF NOT EXISTS gvlp_operators (
  operator_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'starter',
  tokens_balance INTEGER NOT NULL DEFAULT 100,
  tokens_granted_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);