/**
 * CampaignProcessor
 * Core engine for processing campaign calls sequentially
 * Manages call queue, VAPI integration, webhook handling, and retry logic
 */

import { getDatabase } from '../db/database.js';
import { calculateNextRetry, getRandomDelay } from './business-hours.js';
import fetch from 'node-fetch';

class CampaignProcessor {
  constructor(io, logToGoogleSheets) {
    this.io = io;
    this.logToGoogleSheets = logToGoogleSheets;
    this.activeCampaigns = new Map();
    this.processing = false;
    this.pollingIntervals = new Map();
  }

  /**
   * Start processing a campaign
   * @param {number} campaignId - Campaign ID to process
   */
  async start(campaignId) {
    const db = getDatabase();

    try {
      db.prepare(`
        UPDATE campaigns
        SET status = 'running', started_at = datetime('now')
        WHERE id = ?
      `).run(campaignId);
      db.prepare(`UPDATE batches SET status = 'running', started_at = datetime('now') WHERE id = ?`).run(campaignId);

      this.activeCampaigns.set(campaignId, { status: 'running' });

      console.log(`🚀 Started campaign ${campaignId}`);
      this.io.emit('campaign-started', { campaignId, batchId: campaignId });

      await this.processQueue(campaignId);

    } catch (error) {
      console.error(`❌ Error starting campaign ${campaignId}:`, error);
      this.activeCampaigns.delete(campaignId);
      throw error;
    }
  }

  /**
   * Pause a campaign (will finish current call then stop)
   * @param {number} campaignId - Campaign ID to pause
   */
  pause(campaignId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE campaigns SET status = 'paused' WHERE id = ?
    `).run(campaignId);
    db.prepare(`UPDATE batches SET status = 'paused' WHERE id = ?`).run(campaignId);

    const state = this.activeCampaigns.get(campaignId);
    if (state) state.status = 'paused';

    console.log(`⏸️  Paused campaign ${campaignId}`);
    this.io.emit('campaign-paused', { campaignId, batchId: campaignId });
  }

  /**
   * Resume a paused campaign
   * @param {number} campaignId - Campaign ID to resume
   */
  async resume(campaignId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE campaigns SET status = 'running' WHERE id = ?
    `).run(campaignId);
    db.prepare(`UPDATE batches SET status = 'running' WHERE id = ?`).run(campaignId);

    this.activeCampaigns.set(campaignId, { status: 'running' });

    console.log(`▶️  Resumed campaign ${campaignId}`);
    this.io.emit('campaign-resumed', { campaignId, batchId: campaignId });

    await this.processQueue(campaignId);
  }

  /**
   * Cancel a campaign
   * @param {number} campaignId - Campaign ID to cancel
   */
  cancel(campaignId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE campaigns
      SET status = 'cancelled', completed_at = datetime('now')
      WHERE id = ?
    `).run(campaignId);
    db.prepare(`UPDATE batches SET status = 'cancelled', completed_at = datetime('now') WHERE id = ?`).run(campaignId);

    this.activeCampaigns.delete(campaignId);

    console.log(`🛑 Cancelled campaign ${campaignId}`);
    this.io.emit('campaign-cancelled', { campaignId, batchId: campaignId });
  }

  /**
   * Check VAPI concurrency limit
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
   * Process call queue for a campaign
   * @param {number} campaignId - Campaign ID to process
   */
  async processQueue(campaignId) {
    const db = getDatabase();

    while (true) {
      const campaign = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId);

      if (!campaign || campaign.status !== 'running') {
        console.log(`⏹️  Campaign ${campaignId} is ${campaign?.status || 'not found'}, stopping queue`);
        break;
      }

      // Reset any due retries (no_answer / callback_requested) back to 'pending'
      const resetCount = db.prepare(`
        UPDATE contacts
        SET status = 'pending', updated_at = datetime('now')
        WHERE campaign_id = ?
        AND status IN ('no_answer', 'callback_requested')
        AND next_retry_at IS NOT NULL
        AND datetime(next_retry_at) <= datetime('now')
        AND attempt_count < max_attempts
      `).run(campaignId).changes;

      if (resetCount > 0) {
        console.log(`🔄 Reset ${resetCount} contact(s) to pending for retry`);
      }

      const contact = db.prepare(`
        SELECT * FROM contacts
        WHERE campaign_id = ? AND status = 'pending' AND attempt_count < max_attempts
        ORDER BY id ASC
        LIMIT 1
      `).get(campaignId);

      if (!contact) {
        // Check if there are still contacts waiting for a future retry
        const waitingRetries = db.prepare(`
          SELECT COUNT(*) as n FROM contacts
          WHERE campaign_id = ?
          AND status IN ('no_answer', 'callback_requested')
          AND attempt_count < max_attempts
        `).get(campaignId).n;

        if (waitingRetries > 0) {
          // Pause and wait — a retry interval check will resume when they're due
          console.log(`⏳ Campaign ${campaignId} waiting for ${waitingRetries} retry(s)...`);
          await new Promise(resolve => setTimeout(resolve, 60000)); // check again in 1 min
          continue;
        }

        console.log(`✅ Campaign ${campaignId} completed - no more pending contacts`);
        this.completeCampaign(campaignId);
        break;
      }

      await this.processContact(contact);

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
    const campaignId = contact.campaign_id || contact.batch_id;

    try {
      let concurrencyCheckAttempts = 0;
      const maxConcurrencyAttempts = 10;

      while (concurrencyCheckAttempts < maxConcurrencyAttempts) {
        const concurrencyStatus = this.checkVAPIConcurrencyLimit();

        if (concurrencyStatus.available) break;

        console.log(`⏳ VAPI concurrency limit reached (${concurrencyStatus.activeCallCount}/${concurrencyStatus.maxCalls}). Waiting 30s...`);

        this.io.emit('concurrency-limit-reached', {
          campaignId,
          batchId: campaignId,
          contactId: contact.id,
          activeCallCount: concurrencyStatus.activeCallCount,
          maxCalls: concurrencyStatus.maxCalls,
          waitTime: 30
        });

        await new Promise(resolve => setTimeout(resolve, 30000));
        concurrencyCheckAttempts++;
      }

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

      this.io.emit('contact-calling', {
        campaignId,
        batchId: campaignId,
        contactId: contact.id,
        customerName: contact.customer_name,
        phoneNumber: contact.phone_number,
        attemptNumber: contact.attempt_count + 1,
        maxAttempts: contact.max_attempts,
        callStartedAt
      });

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
              _campaignId: String(campaignId),
              _attemptNumber: String(contact.attempt_count + 1)
            }
          },
          metadata: {
            contactId: contact.id,
            campaignId,
            batchId: campaignId,
            attemptNumber: contact.attempt_count + 1
          }
        })
      });

      if (!vapiResponse.ok) {
        throw new Error(`VAPI API error: ${vapiResponse.status} ${vapiResponse.statusText}`);
      }

      const vapiData = await vapiResponse.json();

      db.prepare(`
        UPDATE contacts
        SET vapi_call_id = ?,
            polling_status = 'polling'
        WHERE id = ?
      `).run(vapiData.id, contact.id);

      console.log(`✅ VAPI call initiated: ${vapiData.id}`);

      this.startCallStatusPolling(contact.id, vapiData.id);

    } catch (error) {
      console.error(`❌ Error processing contact ${contact.id}:`, error);

      db.prepare(`
        UPDATE contacts
        SET status = 'failed',
            error_message = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(error.message, contact.id);

      db.prepare(`
        UPDATE campaigns
        SET failed_calls = failed_calls + 1
        WHERE id = ?
      `).run(campaignId);

      db.prepare(`
        INSERT INTO call_logs (
          contact_id, batch_id, campaign_id, attempt_number, call_status,
          error_message, created_at
        ) VALUES (?, ?, ?, ?, 'failed', ?, datetime('now'))
      `).run(contact.id, campaignId, campaignId, contact.attempt_count, error.message);

      this.io.emit('contact-failed', {
        campaignId,
        batchId: campaignId,
        contactId: contact.id,
        error: error.message
      });
    }
  }

  /**
   * Start polling VAPI call status as backup to webhook
   */
  startCallStatusPolling(contactId, vapiCallId) {
    const pollInterval = parseInt(process.env.VAPI_POLL_INTERVAL || '10000');
    const pollTimeout = parseInt(process.env.VAPI_POLL_TIMEOUT || '300000');
    const maxPolls = Math.floor(pollTimeout / pollInterval);
    let pollCount = 0;

    console.log(`🔄 Starting call status polling for contact ${contactId}, VAPI call ${vapiCallId}`);

    const intervalId = setInterval(async () => {
      try {
        const db = getDatabase();
        const contact = db.prepare('SELECT polling_status, call_ended_at FROM contacts WHERE id = ?').get(contactId);

        if (!contact || contact.polling_status === 'webhook_received' || contact.call_ended_at) {
          console.log(`✅ Stopping polling for contact ${contactId} - webhook received or call ended`);
          clearInterval(intervalId);
          this.pollingIntervals.delete(contactId);
          return;
        }

        const response = await fetch(`https://api.vapi.ai/call/${vapiCallId}`, {
          headers: { 'Authorization': `Bearer ${process.env.VAPI_PRIVATE_KEY}` }
        });

        if (!response.ok) {
          console.error(`⚠️  VAPI poll error for ${vapiCallId}: ${response.status}`);
          return;
        }

        const callData = await response.json();

        if (callData.status === 'ended' || callData.endedReason) {
          console.log(`📊 Poll detected call end for ${vapiCallId}`);
          clearInterval(intervalId);
          this.pollingIntervals.delete(contactId);

          db.prepare(`
            UPDATE contacts SET polling_status = 'poll_completed' WHERE id = ?
          `).run(contactId);

          await this.handleCallComplete(contactId, {
            vapiCallId,
            endedReason: callData.endedReason,
            duration: callData.duration || 0,
            transcriptText: callData.transcript || '',
            stereoRecordingUrl: callData.recordingUrl || null
          });
        }

        pollCount++;

        if (pollCount >= maxPolls) {
          console.warn(`⚠️  Polling timeout for contact ${contactId} after ${maxPolls} attempts`);
          clearInterval(intervalId);
          this.pollingIntervals.delete(contactId);

          db.prepare(`
            UPDATE contacts SET polling_status = 'poll_timeout' WHERE id = ?
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
      const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(contactId);
      if (!contact) {
        console.error(`❌ Contact ${contactId} not found`);
        return;
      }

      const campaignId = contact.campaign_id || contact.batch_id;

      console.log(`📊 Processing call completion for contact ${contactId}`);

      if (this.pollingIntervals.has(contactId)) {
        clearInterval(this.pollingIntervals.get(contactId));
        this.pollingIntervals.delete(contactId);
      }

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

      const disposition = this.determineDisposition(callData);

      let nextStatus = disposition.status;
      let nextRetryAt = null;

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

      this.updateCampaignStats(campaignId);

      db.prepare(`
        INSERT INTO call_logs (
          contact_id, batch_id, campaign_id, vapi_call_id, attempt_number,
          call_status, call_disposition, duration_seconds,
          callback_requested, callback_schedule, rating,
          customer_feedback, customer_sentiment, feedback_summary,
          call_summary, transcript_text, recording_url,
          ended_reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        contactId,
        campaignId,
        campaignId,
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

      await this.logToGoogleSheets({
        ...callData,
        campaignId,
        campaignName: this.getCampaignName(campaignId),
        batchId: campaignId,
        batchName: this.getCampaignName(campaignId),
        callStatus: nextStatus,
        callDisposition: disposition.disposition
      });

      this.io.emit('contact-completed', {
        campaignId,
        batchId: campaignId,
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

    if (callData.rating || callData.customerFeedback) {
      return { status: 'completed', disposition: 'completed', needsRetry: false };
    }

    if (callData.callback) {
      return { status: 'callback_requested', disposition: 'callback_requested', needsRetry: true, retryType: 'callback_requested' };
    }

    if (callData.transcriptText && Number(callData.duration) > 0) {
      return { status: 'completed', disposition: 'completed', needsRetry: false };
    }

    return { status: 'no_answer', disposition: 'no_answer', needsRetry: true, retryType: 'no_answer' };
  }

  /**
   * Update campaign statistics
   * @param {number} campaignId - Campaign ID
   */
  updateCampaignStats(campaignId) {
    const db = getDatabase();

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('completed', 'max_attempts') THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status IN ('failed', 'max_attempts') THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status IN ('no_answer', 'callback_requested') THEN 1 ELSE 0 END) as callbacks_pending
      FROM contacts
      WHERE campaign_id = ?
    `).get(campaignId);

    const avgDurationResult = db.prepare(`
      SELECT AVG(call_duration_seconds) as avg_duration
      FROM contacts
      WHERE campaign_id = ? AND call_duration_seconds IS NOT NULL AND call_duration_seconds > 0
    `).get(campaignId);

    const avgCallDuration = avgDurationResult.avg_duration
      ? Math.round(avgDurationResult.avg_duration)
      : 180;

    db.prepare(`
      UPDATE campaigns
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
      campaignId
    );

    this.io.emit('campaign-progress', {
      campaignId,
      batchId: campaignId,
      total: stats.total,
      completed: stats.completed,
      successful: stats.successful,
      failed: stats.failed,
      callbacksPending: stats.callbacks_pending,
      avgCallDuration
    });

    // Legacy event name for backwards compat
    this.io.emit('batch-progress', {
      batchId: campaignId,
      campaignId,
      total: stats.total,
      completed: stats.completed,
      successful: stats.successful,
      failed: stats.failed,
      callbacksPending: stats.callbacks_pending,
      avgCallDuration
    });
  }

  /**
   * Mark campaign as completed
   * @param {number} campaignId - Campaign ID
   */
  completeCampaign(campaignId) {
    const db = getDatabase();

    db.prepare(`
      UPDATE campaigns
      SET status = 'completed', completed_at = datetime('now')
      WHERE id = ?
    `).run(campaignId);
    db.prepare(`UPDATE batches SET status = 'completed', completed_at = datetime('now') WHERE id = ?`).run(campaignId);

    this.activeCampaigns.delete(campaignId);

    this.io.emit('campaign-completed', { campaignId, batchId: campaignId });
    this.io.emit('batch-completed', { batchId: campaignId, campaignId }); // legacy
    console.log(`🎉 Campaign ${campaignId} completed`);
  }

  /**
   * Get campaign name
   * @param {number} campaignId - Campaign ID
   * @returns {string} Campaign name
   */
  getCampaignName(campaignId) {
    const db = getDatabase();
    const campaign = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(campaignId);
    return campaign ? campaign.name : '';
  }

  // Legacy alias used in server/index.js
  getBatchName(campaignId) {
    return this.getCampaignName(campaignId);
  }
}

export default CampaignProcessor;
