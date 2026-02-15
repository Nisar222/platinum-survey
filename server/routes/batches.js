/**
 * Batch Management API Routes
 * Handles Excel upload, batch CRUD operations, and queue management
 */

import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { getDatabase } from '../db/database.js';
import path from 'path';

const router = express.Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx and .xls files are allowed'));
    }
  }
});

/**
 * POST /api/batches/upload
 * Upload Excel file and create batch
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { batchName } = req.body;
    const db = getDatabase();

    // Parse Excel file
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    // Validate columns
    const firstRow = data[0];
    const hasName = 'Customer Name' in firstRow || 'customer name' in firstRow || 'Name' in firstRow || 'name' in firstRow;
    const hasPhone = 'Phone Number' in firstRow || 'phone number' in firstRow || 'Phone' in firstRow || 'phone' in firstRow;

    if (!hasName || !hasPhone) {
      return res.status(400).json({
        error: 'Excel file must have "Customer Name" and "Phone Number" columns',
        hint: 'Column names are case-insensitive'
      });
    }

    // Normalize column names
    const normalizeKey = (obj) => {
      const normalized = {};
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('name')) {
          normalized.customerName = value;
        } else if (lowerKey.includes('phone')) {
          normalized.phoneNumber = value;
        }
      }
      return normalized;
    };

    // Parse and validate contacts
    const contacts = [];
    const errors = [];
    const seenPhones = new Set();

    for (let i = 0; i < data.length; i++) {
      const row = normalizeKey(data[i]);
      const rowNum = i + 2; // Excel row number (1-indexed + header row)

      // Validate customer name
      if (!row.customerName || row.customerName.toString().trim() === '') {
        errors.push({ row: rowNum, error: 'Missing customer name' });
        continue;
      }

      // Validate phone number
      if (!row.phoneNumber || row.phoneNumber.toString().trim() === '') {
        errors.push({ row: rowNum, error: 'Missing phone number' });
        continue;
      }

      // Clean phone number (remove spaces, dashes, parentheses)
      let phone = row.phoneNumber.toString().replace(/[\s\-\(\)]/g, '');

      // Add +1 if missing and number is 10 digits
      if (phone.length === 10 && !phone.startsWith('+')) {
        phone = '+1' + phone;
      } else if (phone.length === 11 && phone.startsWith('1') && !phone.startsWith('+')) {
        phone = '+' + phone;
      } else if (!phone.startsWith('+')) {
        errors.push({ row: rowNum, error: 'Invalid phone format (expected +1234567890 or 1234567890)' });
        continue;
      }

      // Check for duplicates
      if (seenPhones.has(phone)) {
        errors.push({ row: rowNum, error: `Duplicate phone number: ${phone}` });
        continue;
      }
      seenPhones.add(phone);

      contacts.push({
        customerName: row.customerName.toString().trim(),
        phoneNumber: phone
      });
    }

    // If too many errors, reject the upload
    if (errors.length > 0 && errors.length === data.length) {
      return res.status(400).json({
        error: 'All rows failed validation',
        validation: {
          valid: 0,
          invalid: errors.length,
          errors: errors
        }
      });
    }

    // Generate batch name if not provided
    const finalBatchName = batchName || `Batch ${new Date().toISOString().split('T')[0]} ${Date.now()}`;

    // Check if batch name already exists
    const existingBatch = db.prepare('SELECT id FROM batches WHERE name = ?').get(finalBatchName);
    if (existingBatch) {
      return res.status(400).json({ error: 'Batch name already exists. Please choose a different name.' });
    }

    // Create batch in transaction
    const insertBatch = db.transaction((batchName, contactsList) => {
      // Insert batch
      const batchResult = db.prepare(`
        INSERT INTO batches (name, total_contacts, status)
        VALUES (?, ?, 'pending')
      `).run(batchName, contactsList.length);

      const batchId = batchResult.lastInsertRowid;

      // Insert contacts
      const insertContact = db.prepare(`
        INSERT INTO contacts (batch_id, customer_name, phone_number)
        VALUES (?, ?, ?)
      `);

      for (const contact of contactsList) {
        insertContact.run(batchId, contact.customerName, contact.phoneNumber);
      }

      return batchId;
    });

    const batchId = insertBatch(finalBatchName, contacts);

    console.log(`📦 Created batch ${batchId} with ${contacts.length} contacts`);

    res.json({
      success: true,
      batch: {
        id: batchId,
        name: finalBatchName,
        total_contacts: contacts.length,
        status: 'pending'
      },
      validation: {
        valid: contacts.length,
        invalid: errors.length,
        errors: errors.length > 0 ? errors : undefined
      }
    });

  } catch (error) {
    console.error('❌ Error uploading batch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/batches
 * List all batches
 */
router.get('/', (req, res) => {
  try {
    const db = getDatabase();

    const batches = db.prepare(`
      SELECT * FROM batches
      ORDER BY created_at DESC
    `).all();

    res.json({ batches });
  } catch (error) {
    console.error('❌ Error fetching batches:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/batches/:id
 * Get batch details with contacts
 */
router.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const batchId = req.params.id;

    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const contacts = db.prepare(`
      SELECT * FROM contacts
      WHERE batch_id = ?
      ORDER BY id ASC
    `).all(batchId);

    res.json({ batch, contacts });
  } catch (error) {
    console.error('❌ Error fetching batch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/batches/:id/start
 * Start processing a batch
 */
router.post('/:id/start', async (req, res) => {
  try {
    const batchId = parseInt(req.params.id);

    // Batch processor will be passed from server/index.js via req.app.locals
    const batchProcessor = req.app.locals.batchProcessor;
    if (!batchProcessor) {
      return res.status(500).json({ error: 'Batch processor not initialized' });
    }

    await batchProcessor.start(batchId);

    res.json({ success: true, message: `Batch ${batchId} started` });
  } catch (error) {
    console.error('❌ Error starting batch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/batches/:id/pause
 * Pause a batch
 */
router.post('/:id/pause', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;

    if (!batchProcessor) {
      return res.status(500).json({ error: 'Batch processor not initialized' });
    }

    batchProcessor.pause(batchId);

    res.json({ success: true, message: `Batch ${batchId} paused` });
  } catch (error) {
    console.error('❌ Error pausing batch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/batches/:id/resume
 * Resume a paused batch
 */
router.post('/:id/resume', async (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;

    if (!batchProcessor) {
      return res.status(500).json({ error: 'Batch processor not initialized' });
    }

    await batchProcessor.resume(batchId);

    res.json({ success: true, message: `Batch ${batchId} resumed` });
  } catch (error) {
    console.error('❌ Error resuming batch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/batches/:id/cancel
 * Cancel a batch
 */
router.post('/:id/cancel', (req, res) => {
  try {
    const batchId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;

    if (!batchProcessor) {
      return res.status(500).json({ error: 'Batch processor not initialized' });
    }

    batchProcessor.cancel(batchId);

    res.json({ success: true, message: `Batch ${batchId} cancelled` });
  } catch (error) {
    console.error('❌ Error cancelling batch:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/callbacks/pending
 * Get pending callbacks sorted by due date
 */
router.get('/callbacks/pending', (req, res) => {
  try {
    const db = getDatabase();

    const callbacks = db.prepare(`
      SELECT c.*, b.name as batch_name
      FROM contacts c
      JOIN batches b ON c.batch_id = b.id
      WHERE c.status IN ('no_answer', 'callback_requested')
      AND c.next_retry_at IS NOT NULL
      ORDER BY c.next_retry_at ASC
      LIMIT 100
    `).all();

    res.json({ callbacks });
  } catch (error) {
    console.error('❌ Error fetching pending callbacks:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/batches/:id/queue-details
 * Get detailed queue information for a batch
 */
router.get('/:id/queue-details', (req, res) => {
  try {
    const db = getDatabase();
    const batchId = parseInt(req.params.id);

    // Get batch info
    const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    // Get currently calling contact
    const currentContact = db.prepare(`
      SELECT * FROM contacts
      WHERE batch_id = ? AND status = 'calling'
      ORDER BY last_call_at DESC
      LIMIT 1
    `).get(batchId);

    // Get pending contacts
    const pendingContacts = db.prepare(`
      SELECT id, customer_name, phone_number, attempt_count, max_attempts
      FROM contacts
      WHERE batch_id = ? AND status = 'pending'
      ORDER BY id ASC
    `).all(batchId);

    // Calculate estimated wait times
    const avgCallDuration = batch.avg_call_duration_seconds || 180; // Default 3 min
    const delayBetweenCalls = 45; // Average of 30-60s
    const timePerContact = avgCallDuration + delayBetweenCalls;

    const queueDetails = pendingContacts.map((contact, index) => ({
      ...contact,
      queuePosition: index + 1,
      estimatedWaitSeconds: (index + 1) * timePerContact,
      estimatedStartTime: new Date(Date.now() + (index + 1) * timePerContact * 1000).toISOString()
    }));

    res.json({
      batch,
      currentContact,
      queueSize: pendingContacts.length,
      queueDetails,
      avgCallDuration,
      delayBetweenCalls
    });

  } catch (error) {
    console.error('❌ Error fetching queue details:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/batches/:id/contacts
 * Get contacts for a batch with filtering
 */
router.get('/:id/contacts', (req, res) => {
  try {
    const db = getDatabase();
    const batchId = parseInt(req.params.id);
    const { status, limit = 100, offset = 0 } = req.query;

    let query = `
      SELECT * FROM contacts
      WHERE batch_id = ?
    `;
    const params = [batchId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const contacts = db.prepare(query).all(...params);

    // Get total count
    const countQuery = status
      ? 'SELECT COUNT(*) as total FROM contacts WHERE batch_id = ? AND status = ?'
      : 'SELECT COUNT(*) as total FROM contacts WHERE batch_id = ?';
    const countParams = status ? [batchId, status] : [batchId];
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({
      contacts,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/queue/status
 * Get current queue processing status
 */
router.get('/queue/status', (req, res) => {
  try {
    const db = getDatabase();

    const activeBatches = db.prepare(`
      SELECT * FROM batches
      WHERE status = 'running'
    `).all();

    const pendingContacts = db.prepare(`
      SELECT COUNT(*) as count
      FROM contacts
      WHERE status = 'pending'
    `).get();

    const callingContacts = db.prepare(`
      SELECT c.*, b.name as batch_name
      FROM contacts c
      JOIN batches b ON c.batch_id = b.id
      WHERE c.status = 'calling'
    `).all();

    res.json({
      activeBatches,
      pendingCount: pendingContacts.count,
      currentlyCalling: callingContacts
    });
  } catch (error) {
    console.error('❌ Error fetching queue status:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
