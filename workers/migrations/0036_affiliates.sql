-- Affiliate Program Tables - Phase 3
-- VLP affiliate system with lifetime attribution and Stripe Connect

CREATE TABLE IF NOT EXISTS affiliates (
  account_id TEXT PRIMARY KEY,
  referral_code TEXT NOT NULL UNIQUE,
  stripe_connect_account_id TEXT,
  connect_status TEXT NOT NULL DEFAULT 'pending',
  balance_pending INTEGER NOT NULL DEFAULT 0,
  balance_paid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS affiliate_events (
  event_id TEXT PRIMARY KEY,
  referrer_account_id TEXT NOT NULL,
  referred_account_id TEXT NOT NULL,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  gross_amount INTEGER NOT NULL,
  commission_amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS affiliate_payouts (
  payout_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  stripe_transfer_id TEXT,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT NOT NULL,
  completed_at TEXT
);

-- Add referral tracking to accounts table
ALTER TABLE accounts ADD COLUMN referred_by TEXT;