/**
 * Schedule Routes
 * CRUD API for weekly campaign schedules
 */

import { Router } from 'express';
import { getDatabase } from '../db/database.js';

const router = Router();

const VALID_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * GET /api/schedules
 * List all schedules with pending campaign counts
 */
router.get('/', (req, res) => {
  try {
    const db = getDatabase();
    const schedules = db.prepare(`
      SELECT s.*,
        COUNT(CASE WHEN c.status = 'pending' THEN 1 END) as pending_campaigns,
        COUNT(CASE WHEN c.status = 'running' THEN 1 END) as running_campaigns,
        COUNT(CASE WHEN c.status IN ('completed', 'cancelled') THEN 1 END) as completed_campaigns
      FROM schedules s
      LEFT JOIN campaigns c ON c.schedule_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `).all();

    res.json({ schedules });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/schedules
 * Create a new schedule
 */
router.post('/', (req, res) => {
  try {
    const { name, days, startTime, endTime, timezone } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Schedule name is required' });
    }
    if (!days || !Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ error: 'At least one day must be selected' });
    }
    const invalidDays = days.filter(d => !VALID_DAYS.includes(d.toLowerCase()));
    if (invalidDays.length > 0) {
      return res.status(400).json({ error: `Invalid days: ${invalidDays.join(', ')}` });
    }
    if (!startTime || !endTime) {
      return res.status(400).json({ error: 'Start time and end time are required' });
    }
    if (startTime >= endTime) {
      return res.status(400).json({ error: 'Start time must be before end time' });
    }

    const db = getDatabase();
    const result = db.prepare(`
      INSERT INTO schedules (name, days, start_time, end_time, timezone)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      name.trim(),
      JSON.stringify(days.map(d => d.toLowerCase())),
      startTime,
      endTime,
      timezone || 'Asia/Dubai'
    );

    const schedule = db.prepare('SELECT * FROM schedules WHERE id = ?').get(result.lastInsertRowid);
    console.log(`📅 Created schedule: "${name}" (ID: ${schedule.id})`);

    res.status(201).json({ schedule });
  } catch (error) {
    console.error('Error creating schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/schedules/:id
 * Update a schedule
 */
router.put('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const { name, days, startTime, endTime, timezone } = req.body;

    const existing = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    db.prepare(`
      UPDATE schedules
      SET name = COALESCE(?, name),
          days = COALESCE(?, days),
          start_time = COALESCE(?, start_time),
          end_time = COALESCE(?, end_time),
          timezone = COALESCE(?, timezone),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name?.trim() || null,
      days ? JSON.stringify(days.map(d => d.toLowerCase())) : null,
      startTime || null,
      endTime || null,
      timezone || null,
      id
    );

    const updated = db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
    res.json({ schedule: updated });
  } catch (error) {
    console.error('Error updating schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/schedules/:id/stop
 * Deactivate a schedule
 */
router.post('/:id/stop', (req, res) => {
  try {
    const db = getDatabase();
    const result = db.prepare(
      "UPDATE schedules SET active = 0, updated_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    console.log(`⏸️ Schedule ${req.params.id} stopped`);
    res.json({ success: true, message: 'Schedule stopped' });
  } catch (error) {
    console.error('Error stopping schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/schedules/:id/activate
 * Reactivate a stopped schedule
 */
router.post('/:id/activate', (req, res) => {
  try {
    const db = getDatabase();
    const result = db.prepare(
      "UPDATE schedules SET active = 1, updated_at = datetime('now') WHERE id = ?"
    ).run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    console.log(`▶️ Schedule ${req.params.id} activated`);
    res.json({ success: true, message: 'Schedule activated' });
  } catch (error) {
    console.error('Error activating schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/schedules/:id
 * Delete a schedule (unlinks campaigns first)
 */
router.delete('/:id', (req, res) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    // Check for running campaigns
    const running = db.prepare(
      "SELECT COUNT(*) as count FROM campaigns WHERE schedule_id = ? AND status = 'running'"
    ).get(id);

    if (running.count > 0) {
      return res.status(400).json({ error: 'Cannot delete schedule with running campaigns' });
    }

    // Unlink campaigns
    db.prepare('UPDATE campaigns SET schedule_id = NULL WHERE schedule_id = ?').run(id);

    // Delete schedule
    const result = db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Schedule not found' });
    }

    console.log(`🗑️ Schedule ${id} deleted`);
    res.json({ success: true, message: 'Schedule deleted' });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
