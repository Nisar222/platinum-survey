/**
 * Retry Scheduler
 * Runs an hourly cron job to find campaigns with due retries and auto-resume them
 * Also handles callback queue processing
 */

import cron from 'node-cron';
import { getDatabase } from '../db/database.js';
import { isCurrentlyBusinessHours } from './business-hours.js';

class RetryScheduler {
  constructor(campaignProcessor) {
    this.campaignProcessor = campaignProcessor;
    this.cronJob = null;
  }

  /**
   * Start the retry scheduler
   * Runs every 5 minutes to check for due retries
   */
  start() {
    // Run every 5 minutes: "*/5 * * * *"
    this.cronJob = cron.schedule('*/5 * * * *', async () => {
      await this.processRetries();
    });

    console.log('🕐 Retry scheduler started (runs every 5 minutes)');

    // Also run immediately on startup to catch any missed retries
    setTimeout(() => this.processRetries(), 10000); // 10s after startup
  }

  /**
   * Stop the retry scheduler
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('🛑 Retry scheduler stopped');
    }
  }

  /**
   * Find campaigns with due retries and resume them
   */
  async processRetries() {
    const db = getDatabase();

    try {
      // Only process during business hours
      if (!isCurrentlyBusinessHours()) {
        return;
      }

      // Find campaigns that have contacts with due retries but are not running
      const campaignsWithDueRetries = db.prepare(`
        SELECT DISTINCT c.id, c.name, c.status
        FROM campaigns c
        JOIN contacts co ON c.id = co.campaign_id
        WHERE co.status IN ('no_answer', 'callback_requested')
          AND co.attempt_count < co.max_attempts
          AND co.next_retry_at IS NOT NULL
          AND datetime(co.next_retry_at) <= datetime('now')
          AND c.status IN ('pending', 'paused', 'completed')
      `).all();

      if (campaignsWithDueRetries.length === 0) {
        return;
      }

      console.log(`🔄 Retry scheduler: Found ${campaignsWithDueRetries.length} campaign(s) with due retries`);

      for (const campaign of campaignsWithDueRetries) {
        try {
          // Skip if already active in processor
          if (this.campaignProcessor.activeCampaigns.has(campaign.id)) {
            console.log(`⏭️  Campaign ${campaign.id} already active, skipping`);
            continue;
          }

          // Count how many contacts are due
          const dueCount = db.prepare(`
            SELECT COUNT(*) as n
            FROM contacts
            WHERE campaign_id = ?
              AND status IN ('no_answer', 'callback_requested')
              AND attempt_count < max_attempts
              AND next_retry_at IS NOT NULL
              AND datetime(next_retry_at) <= datetime('now')
          `).get(campaign.id).n;

          console.log(`📞 Resuming campaign ${campaign.id} (${campaign.name}) for ${dueCount} due retry(s)`);

          // Resume the campaign - processor will pick up due retries
          await this.campaignProcessor.resume(campaign.id);

        } catch (error) {
          console.error(`❌ Error resuming campaign ${campaign.id} for retries:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Error in retry scheduler:', error);
    }
  }

  /**
   * Get a summary of pending retries across all campaigns
   * @returns {Object} Summary of pending retries
   */
  getPendingRetrySummary() {
    const db = getDatabase();

    const summary = db.prepare(`
      SELECT
        c.id as campaign_id,
        c.name as campaign_name,
        c.status as campaign_status,
        COUNT(CASE WHEN co.status = 'no_answer' THEN 1 END) as no_answer_count,
        COUNT(CASE WHEN co.status = 'callback_requested' THEN 1 END) as callback_count,
        COUNT(CASE WHEN datetime(co.next_retry_at) <= datetime('now') THEN 1 END) as due_now,
        MIN(co.next_retry_at) as next_retry_time
      FROM campaigns c
      JOIN contacts co ON c.id = co.campaign_id
      WHERE co.status IN ('no_answer', 'callback_requested')
        AND co.attempt_count < co.max_attempts
      GROUP BY c.id, c.name, c.status
      ORDER BY MIN(co.next_retry_at) ASC
    `).all();

    return summary;
  }
}

export default RetryScheduler;
