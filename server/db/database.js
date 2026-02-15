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
