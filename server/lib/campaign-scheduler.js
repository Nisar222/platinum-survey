/**
 * Campaign Scheduler
 * Runs a cron job every minute to check if any active schedules have
 * pending campaigns that should be auto-started based on the current day/time.
 */

import cron from 'node-cron';
import { getDatabase } from '../db/database.js';
import { utcToZonedTime } from 'date-fns-tz';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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
        if (!this.isInWindow(schedule)) continue;

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
   * Check if the current time falls within a schedule's window
   * @param {Object} schedule - Schedule row from DB
   * @returns {boolean}
   */
  isInWindow(schedule) {
    const now = new Date();
    const timezone = schedule.timezone || 'Asia/Dubai';
    const zonedNow = utcToZonedTime(now, timezone);

    // Check day of week
    const currentDay = DAY_NAMES[zonedNow.getDay()];
    const scheduledDays = JSON.parse(schedule.days);
    if (!scheduledDays.includes(currentDay)) return false;

    // Check time window (HH:MM format)
    const currentTime = `${String(zonedNow.getHours()).padStart(2, '0')}:${String(zonedNow.getMinutes()).padStart(2, '0')}`;
    if (currentTime < schedule.start_time || currentTime >= schedule.end_time) return false;

    return true;
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
