CREATE TABLE IF NOT EXISTS compliance_status (
  account_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL DEFAULT 'intake',
  intake_complete INTEGER NOT NULL DEFAULT 0,
  esign_2848_complete INTEGER NOT NULL DEFAULT 0,
  processing_complete INTEGER NOT NULL DEFAULT 0,
  tax_record_complete INTEGER NOT NULL DEFAULT 0,
  current_step TEXT,
  step_status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  assigned_professional_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);