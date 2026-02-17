/**
 * Campaign Management API Routes
 * Handles Excel upload, campaign CRUD operations, and queue management
 */

import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';
import { getDatabase } from '../db/database.js';
import path from 'path';
import { readFileSync } from 'fs';

function getMaxAttempts() {
  try {
    const s = JSON.parse(readFileSync(new URL('../../config/settings.json', import.meta.url).pathname, 'utf8'));
    return s.maxAttemptsPerContact || 3;
  } catch { return 3; }
}

const router = express.Router();

/**
 * Map internal contact status to customer-facing display status
 * Completed = survey successfully done
 * Rescheduled = no_answer or callback_requested with retries remaining
 * Failed = max_attempts exhausted or hard failure
 */
function getDisplayStatus(status) {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'no_answer':
    case 'callback_requested':
    case 'calling':
    case 'pending':
      return 'Rescheduled';
    case 'max_attempts':
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

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
 * POST /api/campaigns/upload
 * Upload Excel file and create campaign
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { batchName, campaignName, scheduleId } = req.body;
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

      if (!row.customerName || row.customerName.toString().trim() === '') {
        errors.push({ row: rowNum, error: 'Missing customer name' });
        continue;
      }

      if (!row.phoneNumber || row.phoneNumber.toString().trim() === '') {
        errors.push({ row: rowNum, error: 'Missing phone number' });
        continue;
      }

      let phone = row.phoneNumber.toString().replace(/[\s\-\(\)]/g, '');

      if (phone.length === 10 && !phone.startsWith('+')) {
        phone = '+1' + phone;
      } else if (phone.length === 11 && phone.startsWith('1') && !phone.startsWith('+')) {
        phone = '+' + phone;
      } else if (!phone.startsWith('+')) {
        errors.push({ row: rowNum, error: 'Invalid phone format (expected +1234567890 or 1234567890)' });
        continue;
      }

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

    // Support both campaignName (new) and batchName (legacy) params
    const finalCampaignName = campaignName || batchName || `Campaign ${new Date().toISOString().split('T')[0]} ${Date.now()}`;

    // Check if campaign name already exists
    const existingCampaign = db.prepare('SELECT id FROM campaigns WHERE name = ?').get(finalCampaignName);
    if (existingCampaign) {
      return res.status(400).json({ error: 'Campaign name already exists. Please choose a different name.' });
    }

    // Create campaign in transaction
    const parsedScheduleId = scheduleId ? parseInt(scheduleId) : null;
    const insertCampaign = db.transaction((name, contactsList) => {
      // Insert into campaigns table (primary)
      const campaignResult = db.prepare(`
        INSERT INTO campaigns (name, total_contacts, status, schedule_id)
        VALUES (?, ?, 'pending', ?)
      `).run(name, contactsList.length, parsedScheduleId);

      const campaignId = campaignResult.lastInsertRowid;

      // Also insert into batches table to satisfy the existing FK constraint on contacts.batch_id
      db.prepare(`
        INSERT OR IGNORE INTO batches (id, name, total_contacts, status)
        VALUES (?, ?, ?, 'pending')
      `).run(campaignId, name, contactsList.length);

      const maxAttempts = getMaxAttempts();
      const insertContact = db.prepare(`
        INSERT INTO contacts (batch_id, campaign_id, customer_name, phone_number, max_attempts)
        VALUES (?, ?, ?, ?, ?)
      `);

      for (const contact of contactsList) {
        insertContact.run(campaignId, campaignId, contact.customerName, contact.phoneNumber, maxAttempts);
      }

      return campaignId;
    });

    const campaignId = insertCampaign(finalCampaignName, contacts);

    console.log(`📦 Created campaign ${campaignId} with ${contacts.length} contacts`);

    res.json({
      success: true,
      batch: {
        id: campaignId,
        name: finalCampaignName,
        total_contacts: contacts.length,
        status: 'pending'
      },
      campaign: {
        id: campaignId,
        name: finalCampaignName,
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
    console.error('❌ Error uploading campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/campaigns
 * List campaigns with funnel data
 * Query param: filter=all|active|ended|archived (default: all except archived)
 */
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const { filter = 'all' } = req.query;

    let whereClause;
    if (filter === 'archived') {
      whereClause = `WHERE c.status = 'archived'`;
    } else if (filter === 'active') {
      whereClause = `WHERE c.status IN ('running', 'paused', 'pending')`;
    } else if (filter === 'ended') {
      whereClause = `WHERE c.status IN ('completed', 'cancelled')`;
    } else {
      // Default: exclude archived
      whereClause = `WHERE c.status != 'archived'`;
    }

    const campaigns = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.status,
        c.total_contacts,
        c.completed_contacts,
        c.successful_calls,
        c.failed_calls,
        c.callbacks_pending,
        c.created_at,
        c.started_at,
        c.completed_at,
        COUNT(DISTINCT CASE WHEN co.attempt_count > 0 THEN co.id END) as attempted,
        COUNT(DISTINCT CASE
          WHEN cl.call_status = 'answered' AND cl.duration_seconds > 0
          THEN co.id
        END) as connected,
        COUNT(DISTINCT CASE WHEN co.status = 'completed' THEN co.id END) as completed,
        COUNT(DISTINCT CASE WHEN co.status = 'completed' THEN co.id END) as display_completed,
        COUNT(DISTINCT CASE WHEN co.status IN ('no_answer', 'callback_requested') THEN co.id END) as display_rescheduled,
        COUNT(DISTINCT CASE WHEN co.status IN ('max_attempts', 'failed') THEN co.id END) as display_failed
      FROM campaigns c
      LEFT JOIN contacts co ON c.id = co.campaign_id
      LEFT JOIN call_logs cl ON co.id = cl.contact_id
      ${whereClause}
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();

    res.json({ campaigns, batches: campaigns });
  } catch (error) {
    console.error('❌ Error fetching campaigns:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/archive-old
 * Auto-archive campaigns older than N days (default 30)
 */
router.post('/archive-old', (req, res) => {
  try {
    const db = getDatabase();
    const days = parseInt(req.body?.days || 30);

    const result = db.prepare(`
      UPDATE campaigns
      SET status = 'archived'
      WHERE status IN ('completed', 'cancelled')
        AND datetime(created_at) < datetime('now', '-' || ? || ' days')
    `).run(days);

    db.prepare(`
      UPDATE batches
      SET status = 'archived'
      WHERE status IN ('completed', 'cancelled')
        AND datetime(created_at) < datetime('now', '-' || ? || ' days')
    `).run(days, days);

    console.log(`📦 Auto-archived ${result.changes} campaign(s) older than ${days} days`);
    res.json({ success: true, archived: result.changes });
  } catch (error) {
    console.error('❌ Error auto-archiving campaigns:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/campaigns/reports/calls
 * Get all calls within a date range, optionally filtered by campaign
 * Query params: from, to (ISO date strings), campaignId (optional), format=csv|json
 */
router.get('/reports/calls', (req, res) => {
  try {
    const db = getDatabase();
    const { from, to, campaignId, format = 'json' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to date parameters are required' });
    }

    const fromDate = `${from} 00:00:00`;
    const toDate = `${to} 23:59:59`;

    let query = `
      SELECT
        cl.id,
        cl.created_at as call_time,
        co.customer_name,
        co.phone_number,
        camp.name as campaign_name,
        cl.call_status,
        cl.call_disposition,
        cl.duration_seconds,
        cl.rating,
        cl.customer_feedback,
        cl.customer_sentiment,
        cl.call_summary,
        cl.callback_requested,
        cl.callback_schedule,
        cl.ended_reason,
        cl.recording_url,
        cl.attempt_number
      FROM call_logs cl
      JOIN contacts co ON cl.contact_id = co.id
      LEFT JOIN campaigns camp ON cl.campaign_id = camp.id
      WHERE datetime(cl.created_at) BETWEEN datetime(?) AND datetime(?)
    `;
    const params = [fromDate, toDate];

    if (campaignId) {
      query += ` AND cl.campaign_id = ?`;
      params.push(parseInt(campaignId));
    }

    query += ` ORDER BY cl.created_at DESC`;
    const calls = db.prepare(query).all(...params);

    if (format === 'csv') {
      const headers = [
        'Call Time', 'Customer Name', 'Phone Number', 'Campaign',
        'Call Result', 'Status', 'Disposition', 'Duration (s)', 'Rating',
        'Feedback', 'Sentiment', 'Call Summary',
        'Callback Requested', 'Callback Schedule', 'Ended Reason',
        'Recording URL', 'Attempt #'
      ];

      const escape = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const rows = calls.map(c => [
        c.call_time, c.customer_name, c.phone_number, c.campaign_name,
        getDisplayStatus(c.call_status), c.call_status, c.call_disposition, c.duration_seconds, c.rating,
        c.customer_feedback, c.customer_sentiment, c.call_summary,
        c.callback_requested ? 'Yes' : 'No', c.callback_schedule,
        c.ended_reason, c.recording_url, c.attempt_number
      ].map(escape).join(','));

      const csv = [headers.join(','), ...rows].join('\n');
      const filename = `calls-report-${from}-to-${to}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    }

    res.json({ calls, total: calls.length, from, to });

  } catch (error) {
    console.error('❌ Error generating calls report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/campaigns/:id
 * Get campaign details with contacts
 */
router.get('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = req.params.id;

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const contacts = db.prepare(`
      SELECT * FROM contacts
      WHERE campaign_id = ?
      ORDER BY id ASC
    `).all(campaignId);

    res.json({ campaign, batch: campaign, contacts });
  } catch (error) {
    console.error('❌ Error fetching campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/campaigns/:id/funnel
 * Get funnel data for campaign visualization
 */
router.get('/:id/funnel', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);

    const funnel = db.prepare(`
      SELECT
        c.id as campaign_id,
        c.name as campaign_name,
        COUNT(DISTINCT CASE WHEN co.attempt_count > 0 THEN co.id END) as attempted,
        COUNT(DISTINCT CASE
          WHEN cl.call_status = 'answered' AND cl.duration_seconds > 0
          THEN co.id
        END) as connected,
        COUNT(DISTINCT CASE WHEN co.status = 'completed' THEN co.id END) as completed,
        ROUND(100.0 * COUNT(DISTINCT CASE
          WHEN cl.call_status = 'answered' AND cl.duration_seconds > 0
          THEN co.id
        END) / NULLIF(COUNT(DISTINCT CASE WHEN co.attempt_count > 0 THEN co.id END), 0), 1) as connect_rate,
        ROUND(100.0 * COUNT(DISTINCT CASE WHEN co.status = 'completed' THEN co.id END)
          / NULLIF(COUNT(DISTINCT CASE WHEN co.attempt_count > 0 THEN co.id END), 0), 1) as completion_rate
      FROM campaigns c
      LEFT JOIN contacts co ON c.id = co.campaign_id
      LEFT JOIN call_logs cl ON co.id = cl.contact_id
      WHERE c.id = ?
      GROUP BY c.id, c.name
    `).get(campaignId);

    res.json(funnel || { attempted: 0, connected: 0, completed: 0, connect_rate: 0, completion_rate: 0 });
  } catch (error) {
    console.error('❌ Error fetching campaign funnel:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/start
 * Start processing a campaign
 */
router.post('/:id/start', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;
    if (!batchProcessor) {
      return res.status(500).json({ error: 'Campaign processor not initialized' });
    }

    await batchProcessor.start(campaignId);

    res.json({ success: true, message: `Campaign ${campaignId} started` });
  } catch (error) {
    console.error('❌ Error starting campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/pause
 * Pause a campaign
 */
router.post('/:id/pause', (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;

    if (!batchProcessor) {
      return res.status(500).json({ error: 'Campaign processor not initialized' });
    }

    batchProcessor.pause(campaignId);

    res.json({ success: true, message: `Campaign ${campaignId} paused` });
  } catch (error) {
    console.error('❌ Error pausing campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/resume
 * Resume a paused campaign
 */
router.post('/:id/resume', async (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;

    if (!batchProcessor) {
      return res.status(500).json({ error: 'Campaign processor not initialized' });
    }

    await batchProcessor.resume(campaignId);

    res.json({ success: true, message: `Campaign ${campaignId} resumed` });
  } catch (error) {
    console.error('❌ Error resuming campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/cancel
 * Cancel a campaign
 */
router.post('/:id/cancel', (req, res) => {
  try {
    const campaignId = parseInt(req.params.id);
    const batchProcessor = req.app.locals.batchProcessor;

    if (!batchProcessor) {
      return res.status(500).json({ error: 'Campaign processor not initialized' });
    }

    batchProcessor.cancel(campaignId);

    res.json({ success: true, message: `Campaign ${campaignId} cancelled` });
  } catch (error) {
    console.error('❌ Error cancelling campaign:', error);
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
      SELECT c.*, camp.name as campaign_name
      FROM contacts c
      JOIN campaigns camp ON c.campaign_id = camp.id
      WHERE c.status IN ('no_answer', 'callback_requested')
        AND c.next_retry_at IS NOT NULL
        AND camp.status NOT IN ('cancelled', 'archived')
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
 * GET /api/campaigns/:id/queue-details
 * Get detailed queue information for a campaign
 */
router.get('/:id/queue-details', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const currentContact = db.prepare(`
      SELECT * FROM contacts
      WHERE campaign_id = ? AND status = 'calling'
      ORDER BY last_call_at DESC
      LIMIT 1
    `).get(campaignId);

    const pendingContacts = db.prepare(`
      SELECT id, customer_name, phone_number, attempt_count, max_attempts
      FROM contacts
      WHERE campaign_id = ? AND status = 'pending'
      ORDER BY id ASC
    `).all(campaignId);

    const avgCallDuration = campaign.avg_call_duration_seconds || 180;
    const delayBetweenCalls = 45;
    const timePerContact = avgCallDuration + delayBetweenCalls;

    const queueDetails = pendingContacts.map((contact, index) => ({
      ...contact,
      queuePosition: index + 1,
      estimatedWaitSeconds: (index + 1) * timePerContact,
      estimatedStartTime: new Date(Date.now() + (index + 1) * timePerContact * 1000).toISOString()
    }));

    res.json({
      batch: campaign,
      campaign,
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
 * GET /api/campaigns/:id/contacts
 * Get contacts for a campaign with filtering
 */
router.get('/:id/contacts', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);
    const { status, limit = 100, offset = 0 } = req.query;

    let query = `SELECT * FROM contacts WHERE campaign_id = ?`;
    const params = [campaignId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const contacts = db.prepare(query).all(...params);

    const countQuery = status
      ? 'SELECT COUNT(*) as total FROM contacts WHERE campaign_id = ? AND status = ?'
      : 'SELECT COUNT(*) as total FROM contacts WHERE campaign_id = ?';
    const countParams = status ? [campaignId, status] : [campaignId];
    const { total } = db.prepare(countQuery).get(...countParams);

    res.json({ contacts, total, limit: parseInt(limit), offset: parseInt(offset) });

  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/archive
 * Archive a campaign
 */
router.post('/:id/archive', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);

    db.prepare(`UPDATE campaigns SET status = 'archived' WHERE id = ?`).run(campaignId);
    db.prepare(`UPDATE batches SET status = 'archived' WHERE id = ?`).run(campaignId);

    console.log(`📦 Archived campaign ${campaignId}`);
    res.json({ success: true, message: `Campaign ${campaignId} archived` });
  } catch (error) {
    console.error('❌ Error archiving campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/campaigns/:id/unarchive
 * Restore an archived campaign to completed
 */
router.post('/:id/unarchive', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);

    db.prepare(`UPDATE campaigns SET status = 'completed' WHERE id = ?`).run(campaignId);
    db.prepare(`UPDATE batches SET status = 'completed' WHERE id = ?`).run(campaignId);

    res.json({ success: true, message: `Campaign ${campaignId} restored` });
  } catch (error) {
    console.error('❌ Error unarchiving campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Permanently delete a campaign and all its contacts/call_logs
 * Cancels the campaign first if it's still running
 */
router.delete('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);

    // Cancel in processor if running
    const batchProcessor = req.app.locals.batchProcessor;
    if (batchProcessor) {
      try { batchProcessor.cancel(campaignId); } catch (_) {}
    }

    // Delete all related data
    db.prepare(`DELETE FROM call_logs WHERE campaign_id = ? OR batch_id = ?`).run(campaignId, campaignId);
    db.prepare(`DELETE FROM contacts WHERE campaign_id = ? OR batch_id = ?`).run(campaignId, campaignId);
    db.prepare(`DELETE FROM campaigns WHERE id = ?`).run(campaignId);
    db.prepare(`DELETE FROM batches WHERE id = ?`).run(campaignId);

    console.log(`🗑️  Campaign ${campaignId} permanently deleted`);
    res.json({ success: true, message: `Campaign ${campaignId} deleted` });
  } catch (error) {
    console.error('❌ Error deleting campaign:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/callbacks/summary
 * Get retry/callback summary across all campaigns
 */
router.get('/callbacks/summary', (req, res) => {
  try {
    const retryScheduler = req.app.locals.retryScheduler;
    if (!retryScheduler) {
      return res.status(500).json({ error: 'Retry scheduler not initialized' });
    }
    const summary = retryScheduler.getPendingRetrySummary();
    res.json({ summary });
  } catch (error) {
    console.error('❌ Error fetching callback summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/callbacks/process-now
 * Manually trigger retry processing (outside of scheduled run)
 */
router.post('/callbacks/process-now', async (req, res) => {
  try {
    const retryScheduler = req.app.locals.retryScheduler;
    if (!retryScheduler) {
      return res.status(500).json({ error: 'Retry scheduler not initialized' });
    }
    await retryScheduler.processRetries();
    res.json({ success: true, message: 'Retry processing triggered' });
  } catch (error) {
    console.error('❌ Error triggering retry processing:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/campaigns/:id/export
 * Export campaign results as CSV
 */
router.get('/:id/export', (req, res) => {
  try {
    const db = getDatabase();
    const campaignId = parseInt(req.params.id);

    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const contacts = db.prepare(`
      SELECT
        co.customer_name,
        co.phone_number,
        co.status,
        co.call_disposition,
        co.attempt_count,
        co.max_attempts,
        co.last_call_at,
        co.next_retry_at,
        cl.rating,
        cl.customer_feedback,
        cl.customer_sentiment,
        cl.call_summary,
        cl.duration_seconds,
        cl.callback_requested,
        cl.callback_schedule,
        cl.recording_url,
        cl.ended_reason,
        cl.created_at as call_time
      FROM contacts co
      LEFT JOIN call_logs cl ON co.id = cl.contact_id
        AND cl.id = (SELECT MAX(id) FROM call_logs WHERE contact_id = co.id)
      WHERE co.campaign_id = ?
      ORDER BY co.id ASC
    `).all(campaignId);

    // Build CSV
    const headers = [
      'Customer Name', 'Phone Number', 'Call Result', 'Status', 'Call Disposition',
      'Attempts', 'Max Attempts', 'Last Called', 'Next Retry',
      'Rating', 'Feedback', 'Sentiment', 'Call Summary',
      'Duration (s)', 'Callback Requested', 'Callback Schedule',
      'Recording URL', 'Ended Reason', 'Call Time'
    ];

    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows = contacts.map(c => [
      c.customer_name,
      c.phone_number,
      getDisplayStatus(c.status),
      c.status,
      c.call_disposition,
      c.attempt_count,
      c.max_attempts,
      c.last_call_at,
      c.next_retry_at,
      c.rating,
      c.customer_feedback,
      c.customer_sentiment,
      c.call_summary,
      c.duration_seconds,
      c.callback_requested ? 'Yes' : 'No',
      c.callback_schedule,
      c.recording_url,
      c.ended_reason,
      c.call_time
    ].map(escape).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const filename = `campaign-${campaignId}-${campaign.name.replace(/[^a-z0-9]/gi, '-')}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);

  } catch (error) {
    console.error('❌ Error exporting campaign:', error);
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

    const activeCampaigns = db.prepare(`
      SELECT * FROM campaigns WHERE status = 'running'
    `).all();

    const pendingContacts = db.prepare(`
      SELECT COUNT(*) as count FROM contacts WHERE status = 'pending'
    `).get();

    const callingContacts = db.prepare(`
      SELECT c.*, camp.name as campaign_name
      FROM contacts c
      JOIN campaigns camp ON c.campaign_id = camp.id
      WHERE c.status = 'calling'
    `).all();

    res.json({
      activeCampaigns,
      activeBatches: activeCampaigns, // backwards compat
      pendingCount: pendingContacts.count,
      currentlyCalling: callingContacts
    });
  } catch (error) {
    console.error('❌ Error fetching queue status:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
