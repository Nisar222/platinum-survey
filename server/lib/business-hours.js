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
 * Get the next available business hour from a given datetime
 * @param {Date|string} datetime - Starting datetime
 * @returns {Date} Next available business hour
 */
export function getNextBusinessHour(datetime) {
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
export function calculateNextRetry(outcome, currentTime = new Date(), customerRequestedTime = null) {
  let nextRetry;

  switch (outcome) {
    case 'no_answer':
      // Retry after configured number of days
      nextRetry = addDays(new Date(currentTime), getNoAnswerRetryDays());
      nextRetry = getNextBusinessHour(nextRetry);
      break;

    case 'callback_requested':
      if (customerRequestedTime) {
        // Honor customer's requested time
        nextRetry = typeof customerRequestedTime === 'string'
          ? parseISO(customerRequestedTime)
          : new Date(customerRequestedTime);

        // Guard: parseISO returns Invalid Date for non-ISO strings (e.g. "tomorrow morning")
        const isValidDate = !isNaN(nextRetry.getTime());

        // If invalid or in the past, fall back to default retry hours
        if (!isValidDate || nextRetry <= new Date(currentTime)) {
          if (!isValidDate) console.log(`⚠️  Callback time "${customerRequestedTime}" is not a valid ISO date — defaulting to +${getCallbackRetryHours()} hours`);
          else console.log(`⚠️  Callback time ${nextRetry.toISOString()} is in the past — defaulting to +${getCallbackRetryHours()} hours`);
          nextRetry = addHours(new Date(currentTime), getCallbackRetryHours());
        }

        // Adjust to business hours if outside
        nextRetry = getNextBusinessHour(nextRetry);
      } else {
        // Default to configured callback retry hours
        nextRetry = addHours(new Date(currentTime), getCallbackRetryHours());
        nextRetry = getNextBusinessHour(nextRetry);
      }
      break;

    case 'failed':
      // Retry after configured callback retry hours
      nextRetry = addHours(new Date(currentTime), getCallbackRetryHours());
      nextRetry = getNextBusinessHour(nextRetry);
      break;

    default:
      // Default: next business day
      nextRetry = addDays(new Date(currentTime), getNoAnswerRetryDays());
      nextRetry = getNextBusinessHour(nextRetry);
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
  getNextBusinessHour,
  calculateNextRetry,
  getRandomDelay,
  isCurrentlyBusinessHours,
  getTimezone,
  toLocalTimestamp,
  BUSINESS_HOURS_START,
  BUSINESS_HOURS_END,
};
