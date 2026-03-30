CREATE TABLE IF NOT EXISTS wlvlp_site_configs (
  slug TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  logo_url TEXT,
  updated_at TEXT NOT NULL
);
