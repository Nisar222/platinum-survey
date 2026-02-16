/**
 * BatchCallProcessor
 * Core engine for processing batch calls sequentially
 * Manages call queue, VAPI integration, webhook handling, and retry logic
 */

import { getDatabase } from '../db/database.js';
import { calculateNextRetry, getRandomDelay } from './business-hours.js';
import fetch from 'node-fetch';

class BatchCallProcessor {
  constructor(io, logToGoogleSheets) {
    this.io = io; // Socket.IO instance for real-time updates
    this.logToGoogleSheets = logToGoogleSheets; // Google Sheets logging function
    this.activeBatches = new Map(); // Track active batch processing
    this.processing = false; // Global processing lock
    this.pollingIntervals = new Map(); // Track active polling intervals
  }

  /**
   * Start processing a batch
   * @param {number} batchId - Batch ID to process
   */
  async start(batchId) {
    const db = getDatabase();

    try {
      // Update batch status to 'running'
      db.prepare(`
        UPDATE batches
        SET status = 'running', started_at = datetime('now')
        WHERE id = ?
      `).run(batchId);

      this.activeBatches.set(batchId, { status: 'running' });

      console.log(`🚀 Started batch ${batchId}`);

      // Emit Socket.IO event
      this.io.emit('batch-started', { batchId });

      // Start processing contacts
      await this.processQueue(batchId);

    } catch (error) {
      console.error(`❌ Error starting batch ${batchId}:`, error);
      this.activeBatches.delete(batchId);
      throw error;
    }
  }

  /**
   * Pause a batch (will finish current call then stop)
   * @param {number} batchId - Batch ID to pause
   */
  pause(batchId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE batches
      SET status = 'paused'
      WHERE id = ?
    `).run(batchId);

    const batchState = this.activeBatches.get(batchId);
    if (batchState) {
      batchState.status = 'paused';
    }

    console.log(`⏸️  Paused batch ${batchId}`);
    this.io.emit('batch-paused', { batchId });
  }

  /**
   * Resume a paused batch
   * @param {number} batchId - Batch ID to resume
   */
  async resume(batchId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE batches
      SET status = 'running'
      WHERE id = ?
    `).run(batchId);

    this.activeBatches.set(batchId, { status: 'running' });

    console.log(`▶️  Resumed batch ${batchId}`);
    this.io.emit('batch-resumed', { batchId });

    // Continue processing
    await this.processQueue(batchId);
  }

  /**
   * Cancel a batch
   * @param {number} batchId - Batch ID to cancel
   */
  cancel(batchId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE batches
      SET status = 'cancelled', completed_at = datetime('now')
      WHERE id = ?
    `).run(batchId);

    this.activeBatches.delete(batchId);

    console.log(`🛑 Cancelled batch ${batchId}`);
    this.io.emit('batch-cancelled', { batchId });
  }

  /**
   * Check VAPI concurrency limit
   * @returns {Object} Concurrency status
   */
  checkVAPIConcurrencyLimit() {
    const db = getDatabase();
    const activeCalls = db.prepare(`
      SELECT COUNT(*) as count FROM contacts WHERE status = 'calling'
    `).get();

    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_VAPI_CALLS || '5');

    return {
      available: activeCalls.count < maxConcurrent,
      activeCallCount: activeCalls.count,
      maxCalls: maxConcurrent,
      availableSlots: maxConcurrent - activeCalls.count
    };
  }

  /**
   * Process call queue for a batch
   * @param {number} batchId - Batch ID to process
   */
  async processQueue(batchId) {
    const db = getDatabase();

    while (true) {
      // Check if batch is still running
      const batch = db.prepare('SELECT status FROM batches WHERE id = ?').get(batchId);

      if (!batch || batch.status !== 'running') {
        console.log(`⏹️  Batch ${batchId} is ${batch?.status || 'not found'}, stopping queue`);
        break;
      }

      // Get next pending contact
      const contact = db.prepare(`
        SELECT * FROM contacts
        WHERE batch_id = ? AND status = 'pending' AND attempt_count < max_attempts
        ORDER BY id ASC
        LIMIT 1
      `).get(batchId);

      if (!contact) {
        // No more pending contacts, mark batch as completed
        console.log(`✅ Batch ${batchId} completed - no more pending contacts`);
        this.completeBatch(batchId);
        break;
      }

      // Process this contact
      await this.processContact(contact);

      // Random delay before next call (30-60 seconds)
      const delayMin = parseInt(process.env.BATCH_CALL_DELAY_MIN || '30000');
      const delayMax = parseInt(process.env.BATCH_CALL_DELAY_MAX || '60000');
      const delay = getRandomDelay(delayMin, delayMax);

      console.log(`⏳ Waiting ${Math.round(delay / 1000)}s before next call...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Process a single contact
   * @param {Object} contact - Contact record from database
   */
  async processContact(contact) {
    const db = getDatabase();

    try {
      // Check VAPI concurrency limit (future-proofing for concurrent batches)
      let concurrencyCheckAttempts = 0;
      const maxConcurrencyAttempts = 10; // Wait up to 5 minutes (30s * 10)

      while (concurrencyCheckAttempts < maxConcurrencyAttempts) {
        const concurrencyStatus = this.checkVAPIConcurrencyLimit();

        if (concurrencyStatus.available) {
          break;
        }

        console.log(`⏳ VAPI concurrency limit reached (${concurrencyStatus.activeCallCount}/${concurrencyStatus.maxCalls}). Waiting 30s...`);

        // Emit Socket.IO event
        this.io.emit('concurrency-limit-reached', {
          batchId: contact.batch_id,
          contactId: contact.id,
          activeCallCount: concurrencyStatus.activeCallCount,
          maxCalls: concurrencyStatus.maxCalls,
          waitTime: 30
        });

        await new Promise(resolve => setTimeout(resolve, 30000)); // Wait 30s
        concurrencyCheckAttempts++;
      }

      // Update contact status to 'calling'
      const callStartedAt = new Date().toISOString();
      db.prepare(`
        UPDATE contacts
        SET status = 'calling',
            attempt_count = attempt_count + 1,
            last_call_at = datetime('now'),
            call_started_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(callStartedAt, contact.id);

      console.log(`📞 Calling ${contact.customer_name} at ${contact.phone_number} (Attempt ${contact.attempt_count + 1}/${contact.max_attempts})`);

      // Emit Socket.IO event with enhanced data
      this.io.emit('contact-calling', {
        batchId: contact.batch_id,
        contactId: contact.id,
        customerName: contact.customer_name,
        phoneNumber: contact.phone_number,
        attemptNumber: contact.attempt_count + 1,
        maxAttempts: contact.max_attempts,
        callStartedAt: callStartedAt
      });

      // Make VAPI call
      const vapiResponse = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          assistantId: process.env.VAPI_ASSISTANT_ID,
          phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
          customer: {
            number: contact.phone_number,
            name: contact.customer_name
          },
          assistantOverrides: {
            variableValues: {
              customerName: contact.customer_name,
              _contactId: String(contact.id),
              _campaignId: String(contact.batch_id),
              _attemptNumber: String(contact.attempt_count + 1)
            }
          },
          metadata: {
            contactId: contact.id,
            batchId: contact.batch_id,
            attemptNumber: contact.attempt_count + 1
          }
        })
      });

      if (!vapiResponse.ok) {
        throw new Error(`VAPI API error: ${vapiResponse.status} ${vapiResponse.statusText}`);
      }

      const vapiData = await vapiResponse.json();

      // Update contact with VAPI call ID and polling status
      db.prepare(`
        UPDATE contacts
        SET vapi_call_id = ?,
            polling_status = 'polling'
        WHERE id = ?
      `).run(vapiData.id, contact.id);

      console.log(`✅ VAPI call initiated: ${vapiData.id}`);

      // Start polling as backup to webhook
      this.startCallStatusPolling(contact.id, vapiData.id);

    } catch (error) {
      console.error(`❌ Error processing contact ${contact.id}:`, error);

      // Mark contact as failed
      db.prepare(`
        UPDATE contacts
        SET status = 'failed',
            error_message = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(error.message, contact.id);

      // Update batch failed count
      db.prepare(`
        UPDATE batches
        SET failed_calls = failed_calls + 1
        WHERE id = ?
      `).run(contact.batch_id);

      // Log to call_logs table
      db.prepare(`
        INSERT INTO call_logs (
          contact_id, batch_id, attempt_number, call_status,
          error_message, created_at
        ) VALUES (?, ?, ?, 'failed', ?, datetime('now'))
      `).run(contact.id, contact.batch_id, contact.attempt_count, error.message);

      this.io.emit('contact-failed', {
        batchId: contact.batch_id,
        contactId: contact.id,
        error: error.message
      });
    }
  }

  /**
   * Start polling VAPI call status as backup to webhook
   * @param {number} contactId - Contact ID
   * @param {string} vapiCallId - VAPI call ID
   */
  startCallStatusPolling(contactId, vapiCallId) {
    const pollInterval = parseInt(process.env.VAPI_POLL_INTERVAL || '10000'); // 10s
    const pollTimeout = parseInt(process.env.VAPI_POLL_TIMEOUT || '300000'); // 5 minutes
    const maxPolls = Math.floor(pollTimeout / pollInterval);
    let pollCount = 0;

    console.log(`🔄 Starting call status polling for contact ${contactId}, VAPI call ${vapiCallId}`);

    const intervalId = setInterval(async () => {
      try {
        const db = getDatabase();
        const contact = db.prepare('SELECT polling_status, call_ended_at FROM contacts WHERE id = ?').get(contactId);

        // Stop if webhook already received or call ended
        if (!contact || contact.polling_status === 'webhook_received' || contact.call_ended_at) {
          console.log(`✅ Stopping polling for contact ${contactId} - webhook received or call ended`);
          clearInterval(intervalId);
          this.pollingIntervals.delete(contactId);
          return;
        }

        // Poll VAPI API
        const response = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
          headers: { 'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}` }
        });

        if (!response.ok) {
          console.error(`⚠️  VAPI poll error for ${vapiCallId}: ${response.status}`);
          return;
        }

        const callData = await response.json();

        // Check if call ended
        if (callData.status === 'ended' || callData.endedReason) {
          console.log(`📊 Poll detected call end for ${vapiCallId}`);
          clearInterval(intervalId);
          this.pollingIntervals.delete(contactId);

          // Mark as poll-completed
          db.prepare(`
            UPDATE contacts
            SET polling_status = 'poll_completed'
            WHERE id = ?
          `).run(contactId);

          // Process as if webhook received
          await this.handleCallComplete(contactId, {
            vapiCallId: vapiCallId,
            endedReason: callData.endedReason,
            duration: callData.duration || 0,
            transcriptText: callData.transcript || '',
            stereoRecordingUrl: callData.recordingUrl || null
          });
        }

        pollCount++;

        // Timeout after max polls
        if (pollCount >= maxPolls) {
          console.warn(`⚠️  Polling timeout for contact ${contactId} after ${maxPolls} attempts`);
          clearInterval(intervalId);
          this.pollingIntervals.delete(contactId);

          db.prepare(`
            UPDATE contacts
            SET polling_status = 'poll_timeout'
            WHERE id = ?
          `).run(contactId);
        }

      } catch (error) {
        console.error(`❌ Error polling call status for contact ${contactId}:`, error);
      }
    }, pollInterval);

    this.pollingIntervals.set(contactId, intervalId);
  }

  /**
   * Handle call completion from webhook
   * @param {number} contactId - Contact ID
   * @param {Object} callData - Call data from VAPI webhook
   */
  async handleCallComplete(contactId, callData) {
    const db = getDatabase();

    try {
      // Get contact
      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
      if (!contact) {
        console.error(`❌ Contact ${contactId} not found`);
        return;
      }

      console.log(`📊 Processing call completion for contact ${contactId}`);

      // Stop polling if active
      if (this.pollingIntervals.has(contactId)) {
        clearInterval(this.pollingIntervals.get(contactId));
        this.pollingIntervals.delete(contactId);
      }

      // Mark webhook received and call ended
      const callEndedAt = new Date().toISOString();
      const callStartedAt = contact.call_started_at ? new Date(contact.call_started_at) : null;
      const callDuration = callStartedAt && callEndedAt
        ? Math.floor((new Date(callEndedAt) - callStartedAt) / 1000)
        : (callData.duration || 0);

      db.prepare(`
        UPDATE contacts
        SET polling_status = 'webhook_received',
            call_ended_at = ?,
            call_duration_seconds = ?
        WHERE id = ?
      `).run(callEndedAt, callDuration, contactId);

      // Determine call disposition
      const disposition = this.determineDisposition(callData);

      // Determine next status
      let nextStatus = disposition.status;
      let nextRetryAt = null;

      // Calculate next retry if needed
      if (disposition.needsRetry && contact.attempt_count < contact.max_attempts) {
        nextRetryAt = calculateNextRetry(
          disposition.retryType,
          new Date(),
          callData.callbackSchedule
        );
        console.log(`🔄 Next retry scheduled for: ${nextRetryAt}`);
      } else if (contact.attempt_count >= contact.max_attempts) {
        nextStatus = 'max_attempts';
        console.log(`⚠️  Contact ${contactId} reached max attempts (${contact.max_attempts})`);
      }

      // Update contact
      db.prepare(`
        UPDATE contacts
        SET status = ?,
            call_disposition = ?,
            next_retry_at = ?,
            callback_requested_time = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        nextStatus,
        disposition.disposition,
        nextRetryAt ? nextRetryAt.toISOString() : null,
        callData.callbackSchedule || null,
        contactId
      );

      // Update batch statistics
      this.updateBatchStats(contact.batch_id);

      // Log to call_logs table
      db.prepare(`
        INSERT INTO call_logs (
          contact_id, batch_id, vapi_call_id, attempt_number,
          call_status, call_disposition, duration_seconds,
          callback_requested, callback_schedule, rating,
          customer_feedback, customer_sentiment, feedback_summary,
          call_summary, transcript_text, recording_url,
          ended_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        contactId,
        contact.batch_id,
        callData.vapiCallId || contact.vapi_call_id,
        contact.attempt_count,
        disposition.status,
        disposition.disposition,
        callData.duration || 0,
        callData.callback ? 1 : 0,
        callData.callbackSchedule || null,
        callData.rating || null,
        callData.customerFeedback || null,
        callData.customerSentiment || null,
        callData.feedbackSummary || null,
        callData.callSummary || null,
        callData.transcriptText || null,
        callData.stereoRecordingUrl || null,
        callData.endedReason || null
      );

      // Log to Google Sheets
      await this.logToGoogleSheets({
        ...callData,
        batchId: contact.batch_id,
        batchName: this.getBatchName(contact.batch_id),
        callStatus: nextStatus,
        callDisposition: disposition.disposition
      });

      // Emit Socket.IO event with enhanced data
      this.io.emit('contact-completed', {
        batchId: contact.batch_id,
        contactId,
        customerName: contact.customer_name,
        disposition: disposition.disposition,
        duration: callDuration,
        attemptCount: contact.attempt_count,
        nextRetryAt: nextRetryAt ? nextRetryAt.toISOString() : null
      });

      console.log(`✅ Contact ${contactId} processed: ${disposition.disposition} (${callDuration}s)`);

    } catch (error) {
      console.error(`❌ Error handling call completion for contact ${contactId}:`, error);
    }
  }

  /**
   * Determine call disposition from call data
   * @param {Object} callData - Call data from webhook
   * @returns {Object} Disposition info
   */
  determineDisposition(callData) {
    // Check VAPI structured output Call Disposition first (most reliable signal)
    const vapiDisposition = (callData.callDisposition || '').toString().toLowerCase().trim();
    if (vapiDisposition === 'completed') {
      return { status: 'completed', disposition: 'completed', needsRetry: false };
    }
    if (vapiDisposition === 'callback' || vapiDisposition === 'callback_requested') {
      return { status: 'callback_requested', disposition: 'callback_requested', needsRetry: true, retryType: 'callback_requested' };
    }
    if (vapiDisposition === 'no_answer' || vapiDisposition === 'no answer') {
      return { status: 'no_answer', disposition: 'no_answer', needsRetry: true, retryType: 'no_answer' };
    }

    // Check if customer completed survey
    if (callData.rating || callData.customerFeedback) {
      return { status: 'completed', disposition: 'completed', needsRetry: false };
    }

    // Check if callback requested
    if (callData.callback) {
      return { status: 'callback_requested', disposition: 'callback_requested', needsRetry: true, retryType: 'callback_requested' };
    }

    // Check if call connected (has transcript and duration > 0)
    if (callData.transcriptText && Number(callData.duration) > 0) {
      return { status: 'completed', disposition: 'completed', needsRetry: false };
    }

    // No answer
    return { status: 'no_answer', disposition: 'no_answer', needsRetry: true, retryType: 'no_answer' };
  }

  /**
   * Update batch statistics
   * @param {number} batchId - Batch ID
   */
  updateBatchStats(batchId) {
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('completed', 'max_attempts') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status IN ('failed', 'max_attempts') THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('no_answer', 'callback_requested') THEN 1 ELSE 0 END) as callbacks_pending
      FROM contacts
      WHERE batch_id = ?
    `).get(batchId);

    // Calculate average call duration
    const avgDurationResult = db.prepare(`
      SELECT AVG(call_duration_seconds) as avg_duration
      FROM contacts
      WHERE batch_id = ? AND call_duration_seconds IS NOT NULL AND call_duration_seconds > 0
    `).get(batchId);

    const avgCallDuration = avgDurationResult.avg_duration
      ? Math.round(avgDurationResult.avg_duration)
      : 180; // Default 3 minutes

    db.prepare(`
      UPDATE batches
      SET completed_contacts = ?,
          successful_calls = ?,
          failed_calls = ?,
          callbacks_pending = ?,
          avg_call_duration_seconds = ?,
          last_contact_completed_at = datetime('now')
      WHERE id = ?
    `).run(
      stats.completed,
      stats.successful,
      stats.failed,
      stats.callbacks_pending,
      avgCallDuration,
      batchId
    );

    // Emit progress update
    this.io.emit('batch-progress', {
      batchId,
      total: stats.total,
      completed: stats.completed,
      successful: stats.successful,
      failed: stats.failed,
      callbacksPending: stats.callbacks_pending,
      avgCallDuration: avgCallDuration
    });
  }

  /**
   * Mark batch as completed
   * @param {number} batchId - Batch ID
   */
  completeBatch(batchId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE batches
      SET status = 'completed', completed_at = datetime('now')
      WHERE id = ?
    `).run(batchId);

    this.activeBatches.delete(batchId);

    this.io.emit('batch-completed', { batchId });
    console.log(`🎉 Batch ${batchId} completed`);
  }

  /**
   * Get batch name
   * @param {number} batchId - Batch ID
   * @returns {string} Batch name
   */
  getBatchName(batchId) {
    const db = getDatabase();
    const batch = db.prepare('SELECT name FROM batches WHERE id = ?').get(batchId);
    return batch ? batch.name : '';
  }
}

export default BatchCallProcessor;
