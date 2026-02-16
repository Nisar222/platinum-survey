-- Platinum Survey Campaign Calling System Database Schema
-- SQLite database for managing campaigns, contacts, and call history
-- NOTE: This file only creates tables that DON'T exist yet.
-- Column additions for existing tables are handled by the migration script.

-- ============================================================================
-- Table: campaigns (primary table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  total_contacts INTEGER NOT NULL DEFAULT 0,
  completed_contacts INTEGER NOT NULL DEFAULT 0,
  successful_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0,
  callbacks_pending INTEGER NOT NULL DEFAULT 0,
  avg_call_duration_seconds INTEGER,
  last_contact_completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);

-- ============================================================================
-- Table: batches (legacy - kept for backwards compatibility)
-- ============================================================================
CREATE TABLE IF NOT EXISTS batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  total_contacts INTEGER NOT NULL DEFAULT 0,
  completed_contacts INTEGER NOT NULL DEFAULT 0,
  successful_calls INTEGER NOT NULL DEFAULT 0,
  failed_calls INTEGER NOT NULL DEFAULT 0,
  callbacks_pending INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_batches_status ON batches(status);
CREATE INDEX IF NOT EXISTS idx_batches_created_at ON batches(created_at);

-- ============================================================================
-- Table: contacts
-- NOTE: campaign_id column is added by migration script if not present
-- ============================================================================
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  call_disposition TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_call_at DATETIME,
  next_retry_at DATETIME,
  callback_requested_time DATETIME,
  vapi_call_id TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_contacts_batch_id ON contacts(batch_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_next_retry_at ON contacts(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(phone_number);

-- ============================================================================
-- Table: call_logs
-- NOTE: campaign_id column is added by migration script if not present
-- ============================================================================
CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL,
  batch_id INTEGER NOT NULL,
  vapi_call_id TEXT,
  attempt_number INTEGER NOT NULL,
  call_status TEXT NOT NULL,
  call_disposition TEXT,
  duration_seconds INTEGER,
  callback_requested BOOLEAN DEFAULT 0,
  callback_schedule DATETIME,
  rating INTEGER,
  customer_feedback TEXT,
  customer_sentiment TEXT,
  feedback_summary TEXT,
  call_summary TEXT,
  transcript_text TEXT,
  recording_url TEXT,
  ended_reason TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_call_logs_contact_id ON call_logs(contact_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_batch_id ON call_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_vapi_call_id ON call_logs(vapi_call_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_created_at ON call_logs(created_at);

-- ============================================================================
-- Table: schedules (weekly recurring campaign schedules)
-- ============================================================================
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  days TEXT NOT NULL,                          -- JSON array: ["mon","wed","fri"]
  start_time TEXT NOT NULL DEFAULT '09:00',    -- HH:MM 24h format
  end_time TEXT NOT NULL DEFAULT '17:00',      -- HH:MM 24h format
  timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  active INTEGER NOT NULL DEFAULT 1,           -- 1=active, 0=stopped
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedules_active ON schedules(active);
