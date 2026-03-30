CREATE TABLE IF NOT EXISTS tcvlp_pros (
  pro_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  firm_name TEXT NOT NULL,
  display_name TEXT,
  logo_url TEXT,
  welcome_message TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);