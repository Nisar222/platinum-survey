/**
 * Business Hours Logic
 * Handles scheduling constraints: business hours, weekends, holidays
 */

import {
  addDays,
  addHours,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
  format,
  parseISO
} from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime, format as formatTz } from 'date-fns-tz';

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BUSINESS_HOURS_START = parseInt(process.env.BUSINESS_HOURS_START || '9');  // 9 AM
const BUSINESS_HOURS_END = parseInt(process.env.BUSINESS_HOURS_END || '18');     // 6 PM

// Read timezone dynamically from settings.json so changes take effect without restart
function getTimezone() {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (s.timezone) return s.timezone;
  } catch {}
  return process.env.TIMEZONE || 'Asia/Dubai';
}

/**
 * Convert a UTC timestamp string (as stored in SQLite) to a local time string
 * in the configured timezone. Uses date-fns-tz for correct half-hour zone support.
 * @param {string|null} utcStr - UTC datetime string e.g. "2026-02-24 08:37:57"
 * @param {string} [timezone] - IANA timezone, defaults to configured timezone
 * @returns {string} Local time formatted as "yyyy-MM-dd HH:mm:ss", or '' if null
 */
export function toLocalTimestamp(utcStr, timezone) {
  if (!utcStr) return '';
  const tz = timezone || getTimezone();
  // SQLite stores without 'Z' — append it so JS parses as UTC
  const utcDate = new Date(utcStr.includes('T') ? utcStr : utcStr.replace(' ', 'T') + 'Z');
  if (isNaN(utcDate.getTime())) return '';
  const zoned = utcToZonedTime(utcDate, tz);
  return formatTz(zoned, 'yyyy-MM-dd HH:mm:ss', { timeZone: tz });
}


// Load working days + retry hours from settings.json (re-read each call so changes take effect without restart)
function getWorkingDays() {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    // workingDays is array of day numbers: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    if (Array.isArray(s.workingDays) && s.workingDays.length > 0) return s.workingDays;
  } catch {}
  // Default: Mon–Sat (UAE post-2022 calendar)
  return [1, 2, 3, 4, 5, 6];
}

function getCallbackRetryHours() {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (s.callbackRetryHours) return parseInt(s.callbackRetryHours);
  } catch {}
  return 4;
}

function getNoAnswerRetryDays() {
  try {
    const settingsPath = path.join(__dirname, '../../config/settings.json');
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (s.noAnswerRetryDays) return parseFloat(s.noAnswerRetryDays);
  } catch {}
  return 1;
}

function isWorkingDay(date) {
  const workingDays = getWorkingDays();
  return workingDays.includes(date.getDay());
}

// Load holidays from config file
let holidays = [];
try {
  const holidaysPath = path.join(process.cwd(), 'config', 'holidays.json');
  if (fs.existsSync(holidaysPath)) {
    const holidaysData = JSON.parse(fs.readFileSync(holidaysPath, 'utf8'));
    holidays = holidaysData.holidays || [];
  }
} catch (error) {
  console.warn('⚠️  Could not load holidays.json, continuing without holiday data');
}

/**
 * Check if a given datetime is within business hours
 * @param {Date|string} datetime - Date to check
 * @returns {boolean} True if within business hours (9 AM - 5 PM on weekdays)
 */
export function isBusinessHours(datetime) {
  const date = typeof datetime === 'string' ? parseISO(datetime) : datetime;
  const zonedDate = utcToZonedTime(date, getTimezone());

  // Check if non-working day
  if (!isWorkingDay(zonedDate)) {
    return false;
  }

  // Check if holiday
  if (isHoliday(zonedDate)) {
    return false;
  }

  // Check hour range
  const hour = zonedDate.getHours();
  return hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END;
}

/**
 * Check if a date is a holiday
 * @param {Date} date - Date to check
 * @returns {boolean} True if it's a holiday
 */
export function isHoliday(date) {
  const dateStr = format(date, 'yyyy-MM-dd');
  return holidays.includes(dateStr);
}

/**
 * Check if the current time falls within a schedule's day/time window.
 * Shared by CampaignScheduler and RetryScheduler.
 * @param {Object} schedule - Schedule row from DB (days, start_time, end_time, timezone)
 * @returns {boolean}
 */
export function isInWindow(schedule) {
  const now = new Date();
  const timezone = schedule.timezone || 'Asia/Dubai';
  const zonedNow = utcToZonedTime(now, timezone);
  const currentDay = DAY_NAMES[zonedNow.getDay()];
  const scheduledDays = JSON.parse(schedule.days);
  if (!scheduledDays.includes(currentDay)) return false;
  const currentTime = `${String(zonedNow.getHours()).padStart(2, '0')}:${String(zonedNow.getMinutes()).padStart(2, '0')}`;
  if (currentTime < schedule.start_time || currentTime >= schedule.end_time) return false;
  return true;
}

/**
 * Given a schedule object, return its day numbers array (0=Sun … 6=Sat) and
 * start/end hours as integers so getNextScheduleHour can use them.
 */
function parseSchedule(schedule) {
  const days = JSON.parse(schedule.days).map(d => DAY_NAMES.indexOf(d)).filter(n => n >= 0);
  const [startH, startM] = schedule.start_time.split(':').map(Number);
  const [endH, endM] = schedule.end_time.split(':').map(Number);
  const timezone = schedule.timezone || 'Asia/Dubai';
  return { days, startH, startM, endH, endM, timezone };
}

/**
 * Snap a datetime to the next opening of a specific campaign schedule window.
 * Equivalent to getNextBusinessHour() but uses schedule-specific days/times.
 * @param {Date} datetime
 * @param {Object} schedule - Schedule row from DB
 * @returns {Date} UTC datetime at the next schedule window opening
 */
function getNextScheduleHour(datetime, schedule) {
  const { days, startH, startM, endH, endM, timezone } = parseSchedule(schedule);
  let zonedDate = utcToZonedTime(new Date(datetime), timezone);

  for (let i = 0; i < 14; i++) {
    const dayNum = zonedDate.getDay();
    if (days.includes(dayNum)) {
      const h = zonedDate.getHours();
      const m = zonedDate.getMinutes();
      const afterStart = h > startH || (h === startH && m >= startM);
      const beforeEnd  = h < endH   || (h === endH   && m < endM);
      if (afterStart && beforeEnd) {
        return zonedTimeToUtc(zonedDate, timezone);
      }
      // Before window opens today — snap to start
      if (!afterStart) {
        zonedDate = setHours(setMinutes(setSeconds(setMilliseconds(zonedDate, 0), 0), startM), startH);
        return zonedTimeToUtc(zonedDate, timezone);
      }
    }
    // Move to next day at schedule start time
    zonedDate = addDays(setHours(setMinutes(setSeconds(setMilliseconds(zonedDate, 0), 0), startM), startH), 1);
  }
  // Fallback: return original (should never reach here)
  return zonedTimeToUtc(zonedDate, timezone);
}

/**
 * Get the next available business hour from a given datetime.
 * If a campaign schedule is provided, uses that schedule's days/times.
 * Otherwise falls back to global business hours from settings.
 * @param {Date|string} datetime - Starting datetime
 * @param {Object|null} schedule - Optional campaign schedule row from DB
 * @returns {Date} Next available datetime within the schedule/business window
 */
export function getNextBusinessHour(datetime, schedule = null) {
  if (schedule) {
    return getNextScheduleHour(datetime, schedule);
  }

  const tz = getTimezone();
  let date = typeof datetime === 'string' ? parseISO(datetime) : new Date(datetime);
  let zonedDate = utcToZonedTime(date, tz);

  // If we're already in business hours, return as-is (pass UTC date — isBusinessHours zones it internally)
  if (isBusinessHours(date)) {
    return date;
  }

  // Move to next business day start time
  let attempts = 0;
  const maxAttempts = 365; // Prevent infinite loop

  while (attempts < maxAttempts) {
    const hour = zonedDate.getHours();

    // If before business hours today, move to start of business hours
    if (hour < BUSINESS_HOURS_START && isWorkingDay(zonedDate) && !isHoliday(zonedDate)) {
      zonedDate = setHours(setMinutes(setSeconds(setMilliseconds(zonedDate, 0), 0), 0), BUSINESS_HOURS_START);
      break;
    }

    // Otherwise, move to next day's business hours start
    zonedDate = addDays(zonedDate, 1);
    zonedDate = setHours(setMinutes(zonedDate, 0), BUSINESS_HOURS_START);

    // Check if this day is valid
    if (isWorkingDay(zonedDate) && !isHoliday(zonedDate)) {
      break;
    }

    attempts++;
  }

  // Convert back to UTC
  return zonedTimeToUtc(zonedDate, tz);
}

/**
 * Calculate next retry time based on call outcome
 * @param {string} outcome - Call outcome: 'no_answer', 'callback_requested', or 'failed'
 * @param {Date|string} currentTime - Current time
 * @param {Date|string|null} customerRequestedTime - Customer's requested callback time (optional)
 * @returns {Date} Next retry datetime
 */
export function calculateNextRetry(outcome, currentTime = new Date(), customerRequestedTime = null, schedule = null) {
  let nextRetry;

  switch (outcome) {
    case 'no_answer':
      nextRetry = addDays(new Date(currentTime), getNoAnswerRetryDays());
      nextRetry = getNextBusinessHour(nextRetry, schedule);
      break;

    case 'callback_requested':
      if (customerRequestedTime) {
        nextRetry = typeof customerRequestedTime === 'string'
          ? parseISO(customerRequestedTime)
          : new Date(customerRequestedTime);

        const isValidDate = !isNaN(nextRetry.getTime());
        const now = new Date(currentTime);
        const isPast = isValidDate && nextRetry <= now;

        if (!isValidDate) {
          console.log(`⚠️  Callback time "${customerRequestedTime}" is not a valid ISO date — escalating`);
          return { nextRetry: null, requiresEscalation: true };
        }
        if (isPast) {
          console.log(`⚠️  Callback time ${nextRetry.toISOString()} is in the past — escalating`);
          return { nextRetry: null, requiresEscalation: true };
        }

        if (schedule) {
          // Validate callback falls on a scheduled day within the schedule window
          const { days, startH, startM, endH, endM, timezone } = parseSchedule(schedule);
          const zonedRequested = utcToZonedTime(nextRetry, timezone);
          const dayNum = zonedRequested.getDay();
          const h = zonedRequested.getHours();
          const m = zonedRequested.getMinutes();
          const onScheduledDay = days.includes(dayNum);
          const withinWindow = (h > startH || (h === startH && m >= startM)) &&
                               (h < endH   || (h === endH   && m < endM));
          if (!onScheduledDay || !withinWindow) {
            console.log(`⚠️  Callback time ${nextRetry.toISOString()} is outside campaign schedule — escalating`);
            return { nextRetry: null, requiresEscalation: true };
          }
        } else {
          // No schedule — keep flat 3-day fallback
          const maxAllowed = addDays(now, 3);
          if (nextRetry > maxAllowed) {
            console.log(`⚠️  Callback time ${nextRetry.toISOString()} is more than 3 days away — escalating`);
            return { nextRetry: null, requiresEscalation: true };
          }
        }

        nextRetry = getNextBusinessHour(nextRetry, schedule);
      } else {
        nextRetry = addHours(new Date(currentTime), getCallbackRetryHours());
        nextRetry = getNextBusinessHour(nextRetry, schedule);
      }
      break;

    case 'failed':
      nextRetry = addHours(new Date(currentTime), getCallbackRetryHours());
      nextRetry = getNextBusinessHour(nextRetry, schedule);
      break;

    default:
      nextRetry = addDays(new Date(currentTime), getNoAnswerRetryDays());
      nextRetry = getNextBusinessHour(nextRetry, schedule);
  }

  return nextRetry;
}

/**
 * Get a random delay in milliseconds between min and max
 * Used for spacing out calls to avoid rate limiting
 * @param {number} min - Minimum delay in ms (default 30000 = 30 seconds)
 * @param {number} max - Maximum delay in ms (default 60000 = 60 seconds)
 * @returns {number} Random delay in milliseconds
 */
export function getRandomDelay(min = 30000, max = 60000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Check if current time is within business hours (convenience function)
 * @returns {boolean} True if current time is within business hours
 */
export function isCurrentlyBusinessHours() {
  return isBusinessHours(new Date());
}

export default {
  isBusinessHours,
  isHoliday,
  isInWindow,
  getNextBusinessHour,
  calculateNextRetry,
  getRandomDelay,
  isCurrentlyBusinessHours,
  getTimezone,
  toLocalTimestamp,
  BUSINESS_HOURS_START,
  BUSINESS_HOURS_END,
};
