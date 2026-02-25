/**
 * Database connection singleton for SQLite
 * Initializes database with schema and provides connection instance
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

/**
 * Safely add missing columns to existing tables (idempotent)
 * Run on every startup so deployments never leave columns missing
 */
function runMigrations(db) {
  const getColumns = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);

  const addColumnIfMissing = (table, column, type) => {
    try {
      const cols = getColumns(table);
      if (!cols.includes(column)) {
        db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
        console.log(`✅ Migration: added ${table}.${column}`);
      }
    } catch (e) {
      // Ignore "duplicate column" errors — already exists
      if (!e.message.includes('duplicate column')) {
        console.warn(`⚠️  Migration warning for ${table}.${column}:`, e.message);
      }
    }
  };

  // campaigns table
  addColumnIfMissing('campaigns', 'schedule_id', 'INTEGER REFERENCES schedules(id)');
  addColumnIfMissing('campaigns', 'avg_call_duration_seconds', 'INTEGER');
  addColumnIfMissing('campaigns', 'last_contact_completed_at', 'DATETIME');

  // contacts table
  addColumnIfMissing('contacts', 'campaign_id', 'INTEGER');
  addColumnIfMissing('contacts', 'call_started_at', 'DATETIME');
  addColumnIfMissing('contacts', 'call_ended_at', 'DATETIME');
  addColumnIfMissing('contacts', 'call_duration_seconds', 'INTEGER');
  addColumnIfMissing('contacts', 'polling_status', 'TEXT');

  // call_logs table
  addColumnIfMissing('call_logs', 'campaign_id', 'INTEGER');
  addColumnIfMissing('call_logs', 'transcript_text', 'TEXT');
  addColumnIfMissing('call_logs', 'ended_reason', 'TEXT');
  addColumnIfMissing('call_logs', 'feedback_summary', 'TEXT');
  addColumnIfMissing('call_logs', 'call_summary', 'TEXT');
  addColumnIfMissing('call_logs', 'escalation_required', 'INTEGER DEFAULT 0');

  // contacts table — escalation flag for quick lookup
  addColumnIfMissing('contacts', 'escalation_required', 'INTEGER DEFAULT 0');
}

/**
 * Initialize and return SQLite database connection
 * @returns {Database} SQLite database instance
 */
export function initializeDatabase() {
  if (db) {
    return db;
  }

  const dbPath = process.env.DATABASE_PATH || './batches.db';

  console.log(`📦 Initializing SQLite database at: ${dbPath}`);

  // Create database connection
  db = new Database(dbPath);

  // Enable WAL mode for better concurrency (multiple readers, one writer)
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Run schema to create tables if they don't exist
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  try {
    db.exec(schema);
    console.log('✅ Database schema initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database schema:', error);
    throw error;
  }

  // Run safe column migrations (idempotent — safe to run on every startup)
  runMigrations(db);

  return db;
}

/**
 * Get existing database connection
 * @returns {Database} SQLite database instance
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    console.log('📦 Database connection closed');
  }
}

/**
 * Recovery function to reset stuck calls on server startup
 * Detects contacts stuck in 'calling' state and resets them to 'pending'
 */
export async function recoverStuckCalls() {
  const database = getDatabase();

  try {
    // Find contacts stuck in 'calling' state for more than 5 minutes
    const stuckContacts = database.prepare(`
      UPDATE contacts
      SET status = 'pending',
          error_message = 'Call recovered after server restart'
      WHERE status = 'calling'
      AND datetime(last_call_at) < datetime('now', '-5 minutes')
    `).run();

    if (stuckContacts.changes > 0) {
      console.log(`🔄 Recovered ${stuckContacts.changes} stuck calls`);
    }

    // Resume any batches that were running
    const runningBatches = database.prepare(`
      SELECT * FROM batches WHERE status = 'running'
    `).all();

    if (runningBatches.length > 0) {
      console.log(`🔄 Found ${runningBatches.length} batches that were running before restart`);
      // These will be auto-resumed by the batch processor
    }

    return { stuckCalls: stuckContacts.changes, runningBatches: runningBatches.length };
  } catch (error) {
    console.error('❌ Error recovering stuck calls:', error);
    throw error;
  }
}

export default {
  initializeDatabase,
  getDatabase,
  closeDatabase,
  recoverStuckCalls
};
