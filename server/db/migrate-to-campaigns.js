/**
 * Migration: Rename batches → campaigns
 * Safe to run multiple times (idempotent)
 *
 * Run with: node server/db/migrate-to-campaigns.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DATABASE_PATH || './batches.db';
console.log(`📦 Opening database at: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // off during migration

function getTableNames() {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(t => t.name);
}

function getColumnNames(table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

async function migrate() {
  const tables = getTableNames();
  const hasCampaigns = tables.includes('campaigns');
  const hasBatches = tables.includes('batches');

  // Step 1: Create campaigns table if it doesn't exist
  if (!hasCampaigns) {
    console.log('📋 Creating campaigns table...');
    db.exec(`
      CREATE TABLE campaigns (
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
      )
    `);
    console.log('✅ Created campaigns table');
  } else {
    console.log('ℹ️  campaigns table already exists');
  }

  // Step 2: Copy data from batches to campaigns (if batches exists and has data)
  if (hasBatches) {
    const batchCount = db.prepare('SELECT COUNT(*) as n FROM batches').get().n;
    if (batchCount > 0) {
      const campaignCount = db.prepare('SELECT COUNT(*) as n FROM campaigns').get().n;
      if (campaignCount === 0) {
        console.log(`📋 Copying ${batchCount} batch(es) to campaigns...`);
        // Copy only columns that exist in both
        db.exec(`
          INSERT OR IGNORE INTO campaigns (id, name, status, total_contacts, completed_contacts,
            successful_calls, failed_calls, callbacks_pending, created_at, started_at, completed_at)
          SELECT id, name, status, total_contacts, completed_contacts,
            successful_calls, failed_calls, callbacks_pending, created_at, started_at, completed_at
          FROM batches
        `);
        console.log(`✅ Copied ${batchCount} batch(es) to campaigns`);
      } else {
        console.log(`ℹ️  campaigns table already has ${campaignCount} record(s), skipping copy`);
      }
    }
  }

  // Step 3: Add campaign_id to contacts if missing
  const contactCols = getColumnNames('contacts');
  if (!contactCols.includes('campaign_id')) {
    console.log('📋 Adding campaign_id to contacts...');
    db.exec(`ALTER TABLE contacts ADD COLUMN campaign_id INTEGER`);
    db.exec(`UPDATE contacts SET campaign_id = batch_id WHERE campaign_id IS NULL`);
    console.log('✅ Added campaign_id to contacts');
  } else {
    // Make sure campaign_id is populated
    db.exec(`UPDATE contacts SET campaign_id = batch_id WHERE campaign_id IS NULL`);
    console.log('ℹ️  contacts.campaign_id already exists');
  }

  // Step 4: Add campaign_id to call_logs if missing
  const logCols = getColumnNames('call_logs');
  if (!logCols.includes('campaign_id')) {
    console.log('📋 Adding campaign_id to call_logs...');
    db.exec(`ALTER TABLE call_logs ADD COLUMN campaign_id INTEGER`);
    db.exec(`UPDATE call_logs SET campaign_id = batch_id WHERE campaign_id IS NULL`);
    console.log('✅ Added campaign_id to call_logs');
  } else {
    db.exec(`UPDATE call_logs SET campaign_id = batch_id WHERE campaign_id IS NULL`);
    console.log('ℹ️  call_logs.campaign_id already exists');
  }

  // Step 5: Add extra columns to contacts if missing (call_started_at, call_ended_at, etc.)
  const extraContactCols = {
    call_started_at: 'DATETIME',
    call_ended_at: 'DATETIME',
    call_duration_seconds: 'INTEGER',
    polling_status: 'TEXT'
  };
  for (const [col, type] of Object.entries(extraContactCols)) {
    if (!contactCols.includes(col)) {
      db.exec(`ALTER TABLE contacts ADD COLUMN ${col} ${type}`);
      console.log(`✅ Added contacts.${col}`);
    }
  }

  // Step 6: Add avg_call_duration_seconds to campaigns if missing
  const campaignCols = getColumnNames('campaigns');
  const extraCampaignCols = {
    avg_call_duration_seconds: 'INTEGER',
    last_contact_completed_at: 'DATETIME',
    schedule_id: 'INTEGER REFERENCES schedules(id)'
  };
  for (const [col, type] of Object.entries(extraCampaignCols)) {
    if (!campaignCols.includes(col)) {
      db.exec(`ALTER TABLE campaigns ADD COLUMN ${col} ${type}`);
      console.log(`✅ Added campaigns.${col}`);
    }
  }

  // Step 7: Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
    CREATE INDEX IF NOT EXISTS idx_campaigns_created_at ON campaigns(created_at);
    CREATE INDEX IF NOT EXISTS idx_contacts_campaign_id ON contacts(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_call_logs_campaign_id ON call_logs(campaign_id);
  `);
  console.log('✅ Indexes created/verified');

  // Summary
  const finalCount = db.prepare('SELECT COUNT(*) as n FROM campaigns').get().n;
  console.log('');
  console.log('🎉 Migration complete!');
  console.log(`   Campaigns: ${finalCount}`);
  console.log(`   contacts.campaign_id: populated`);
  console.log(`   call_logs.campaign_id: populated`);
  console.log('');
  console.log('   NOTE: Original batches table kept. Server uses campaigns table now.');
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
