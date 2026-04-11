-- 0043_client_pool.sql
-- D1 projection of canonical client pool cases stored in R2
-- R2 remains authoritative: client_pool/{case_id}.json
-- Supports list queries by status (available), professional, and account

CREATE TABLE IF NOT EXISTS client_pool (
  case_id TEXT PRIMARY KEY,
  account_id TEXT,
  servicing_professional_id TEXT,
  status TEXT NOT NULL DEFAULT 'available',
  client_name TEXT,
  service_plan TEXT,
  filing_status TEXT,
  plan_fee_cents INTEGER,
  assigned_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_pool_status ON client_pool(status);
CREATE INDEX IF NOT EXISTS idx_client_pool_professional ON client_pool(servicing_professional_id);
CREATE INDEX IF NOT EXISTS idx_client_pool_account ON client_pool(account_id);
