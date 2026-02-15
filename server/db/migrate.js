/**
 * Database Migration Script
 * Adds new columns for queue management and call progress tracking
 * Safe to run multiple times - checks if columns exist before adding
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Open database
const dbPath = path.join(__dirname, '../../batches.db');
const db = new Database(dbPath);

console.log('🔄 Starting database migration...');

/**
 * Check if a column exists in a table
 */
function columnExists(tableName, columnName) {
  const pragma = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return pragma.some(col => col.name === columnName);
}

/**
 * Add column if it doesn't exist
 */
function addColumnIfNotExists(tableName, columnName, columnDefinition) {
  if (!columnExists(tableName, columnName)) {
    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`;
    db.exec(sql);
    console.log(`✅ Added column: ${tableName}.${columnName}`);
    return true;
  } else {
    console.log(`⏭️  Column already exists: ${tableName}.${columnName}`);
    return false;
  }
}

try {
  // Migrate contacts table
  console.log('\n📋 Migrating contacts table...');
  addColumnIfNotExists('contacts', 'call_started_at', 'DATETIME');
  addColumnIfNotExists('contacts', 'call_ended_at', 'DATETIME');
  addColumnIfNotExists('contacts', 'polling_status', 'TEXT');
  addColumnIfNotExists('contacts', 'call_duration_seconds', 'INTEGER');

  // Migrate batches table
  console.log('\n📋 Migrating batches table...');
  addColumnIfNotExists('batches', 'current_contact_id', 'INTEGER');
  addColumnIfNotExists('batches', 'last_contact_completed_at', 'DATETIME');
  addColumnIfNotExists('batches', 'avg_call_duration_seconds', 'INTEGER DEFAULT 180');

  console.log('\n✅ Migration completed successfully!');

} catch (error) {
  console.error('\n❌ Migration failed:', error);
  process.exit(1);
} finally {
  db.close();
}
