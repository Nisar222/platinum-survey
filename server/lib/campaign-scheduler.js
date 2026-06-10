/**
 * Campaign Scheduler
 * Runs a cron job every minute to check if any active schedules have
 * pending campaigns that should be auto-started based on the current day/time.
 */

import cron from 'node-cron';
import { getDatabase } from '../db/database.js';
import { isInWindow } from './business-hours.js';

class CampaignScheduler {
  constructor(campaignProcessor) {
    this.campaignProcessor = campaignProcessor;
    this.cronJob = null;
  }

  /**
   * Start the scheduler (checks every minute)
   */
  start() {
    this.cronJob = cron.schedule('* * * * *', async () => {
      await this.checkSchedules();
    });

    console.log('📅 Campaign scheduler started (checks every minute)');
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  /**
   * Check all active schedules and auto-start pending campaigns
   */
  async checkSchedules() {
    const db = getDatabase();

    try {
      const schedules = db.prepare(
        'SELECT * FROM schedules WHERE active = 1'
      ).all();

      for (const schedule of schedules) {
        if (!isInWindow(schedule)) continue;

        // Find pending campaigns linked to this schedule
        const pendingCampaigns = db.prepare(`
          SELECT id, name FROM campaigns
          WHERE schedule_id = ? AND status = 'pending'
        `).all(schedule.id);

        for (const campaign of pendingCampaigns) {
          // Skip if already being processed
          if (this.campaignProcessor.activeCampaigns.has(campaign.id)) continue;

          console.log(`📅 Schedule "${schedule.name}" auto-starting campaign "${campaign.name}" (ID: ${campaign.id})`);
          try {
            await this.campaignProcessor.start(campaign.id);
          } catch (err) {
            console.error(`❌ Failed to auto-start campaign ${campaign.id}:`, err);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error in campaign scheduler:', error);
    }
  }

  /**
   * Get all schedules with their pending campaign counts
   */
  getScheduleSummary() {
    const db = getDatabase();
    return db.prepare(`
      SELECT s.*,
        COUNT(CASE WHEN c.status = 'pending' THEN 1 END) as pending_campaigns,
        COUNT(CASE WHEN c.status = 'running' THEN 1 END) as running_campaigns
      FROM schedules s
      LEFT JOIN campaigns c ON c.schedule_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `).all();
  }
}

export default CampaignScheduler;
