-- 0042_compliance_records.sql
-- D1 projection of canonical compliance records stored in R2
-- R2 remains authoritative: compliance_records/{order_id}.json
-- Supports staff queries by account, professional, and record status

CREATE TABLE IF NOT EXISTS compliance_records (
  order_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  servicing_professional_id TEXT NOT NULL,
  client_name TEXT,
  filing_status TEXT,
  compliance_tax_year INTEGER,
  total_irs_balance TEXT,
  irs_account_status TEXT,
  record_status TEXT DEFAULT 'Draft',
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_records_account ON compliance_records(account_id);
CREATE INDEX IF NOT EXISTS idx_compliance_records_professional ON compliance_records(servicing_professional_id);
CREATE INDEX IF NOT EXISTS idx_compliance_records_status ON compliance_records(record_status);
