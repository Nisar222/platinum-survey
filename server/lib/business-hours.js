/**
 * Business Hours Logic
 * Handles scheduling constraints: business hours, weekends, holidays
 */

import {
  addDays,
  addHours,
  setHours,
  setMinutes,
  getDay,
  isWeekend,
  format,
  parseISO
} from 'date-fns';
import { zonedTimeToUtc, utcToZonedTime } from 'date-fns-tz';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const BUSINESS_HOURS_START = parseInt(process.env.BUSINESS_HOURS_START || '9');  // 9 AM
const BUSINESS_HOURS_END = parseInt(process.env.BUSINESS_HOURS_END || '18');     // 6 PM
const TIMEZONE = process.env.TIMEZONE || 'Asia/Dubai';

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
  const zonedDate = utcToZonedTime(date, TIMEZONE);

  // Check if weekend
  if (isWeekend(zonedDate)) {
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
  let date = typeof datetime === 'string' ? parseISO(datetime) : new Date(datetime);
  let zonedDate = utcToZonedTime(date, TIMEZONE);

  // If we're already in business hours, return as-is
  if (isBusinessHours(zonedDate)) {
    return date;
  }

  // Move to next business day start time
  let attempts = 0;
  const maxAttempts = 365; // Prevent infinite loop

  while (attempts < maxAttempts) {
    const hour = zonedDate.getHours();

    // If before business hours today, move to start of business hours
    if (hour < BUSINESS_HOURS_START && !isWeekend(zonedDate) && !isHoliday(zonedDate)) {
      zonedDate = setHours(setMinutes(zonedDate, 0), BUSINESS_HOURS_START);
      break;
    }

    // Otherwise, move to next day's business hours start
    zonedDate = addDays(zonedDate, 1);
    zonedDate = setHours(setMinutes(zonedDate, 0), BUSINESS_HOURS_START);

    // Check if this day is valid
    if (!isWeekend(zonedDate) && !isHoliday(zonedDate)) {
      break;
    }

    attempts++;
  }

  // Convert back to UTC
  return zonedTimeToUtc(zonedDate, TIMEZONE);
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
      // Retry next business day at same time
      nextRetry = addDays(new Date(currentTime), 1);
      nextRetry = getNextBusinessHour(nextRetry);
      break;

    case 'callback_requested':
      if (customerRequestedTime) {
        // Honor customer's requested time
        nextRetry = typeof customerRequestedTime === 'string'
          ? parseISO(customerRequestedTime)
          : new Date(customerRequestedTime);

        // Adjust to business hours if outside
        if (!isBusinessHours(nextRetry)) {
          nextRetry = getNextBusinessHour(nextRetry);
        }
      } else {
        // Default to 4 hours from now if no specific time requested
        nextRetry = addHours(new Date(currentTime), 4);
        nextRetry = getNextBusinessHour(nextRetry);
      }
      break;

    case 'failed':
      // Retry in 4 hours
      nextRetry = addHours(new Date(currentTime), 4);
      nextRetry = getNextBusinessHour(nextRetry);
      break;

    default:
      // Default: next business day
      nextRetry = addDays(new Date(currentTime), 1);
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
  BUSINESS_HOURS_START,
  BUSINESS_HOURS_END,
  TIMEZONE
};
