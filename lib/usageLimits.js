// lib/usageLimits.js — Daily usage limit helper
//
// Tracks per-user usage counters for messages, image generation, video
// generation, and file uploads. Counters are stored in Redis and reset
// automatically every day via a date-based key format.
//
// Key format : {userId}:YYYY-MM-DD  (e.g. user123:2026-03-14, date in Pacific/Auckland timezone)
// Stored value: JSON object with the structure described below.
//
// Usage data structure:
// {
//   messages_used : number,
//   images_used   : number,
//   videos_used   : number,
//   uploads_used  : number
// }
//
// All functions degrade gracefully: callers should wrap them in try/catch so
// that a Redis outage never blocks the core chat flow.

'use strict';

const { redis } = require('./redis');

// TTL of 25 hours ensures the key expires shortly after midnight the next day.
const USAGE_TTL_SECONDS = 25 * 60 * 60;

/**
 * Daily usage limits per plan.
 * null means unlimited.
 */
const PLAN_LIMITS = {
  starter: { messages_per_day: 30,   images_per_day: 10,  videos_per_day: 10,  uploads_per_day: 3   },
  basic:   { messages_per_day: 150,  images_per_day: 50,  videos_per_day: 20,  uploads_per_day: 10  },
  premium: { messages_per_day: 500,  images_per_day: 75,  videos_per_day: 30,  uploads_per_day: 50  },
  ultimate:{ messages_per_day: null, images_per_day: null, videos_per_day: null, uploads_per_day: null }
};

/**
 * Get today's date string in YYYY-MM-DD format using the Pacific/Auckland timezone.
 * Using a fixed timezone ensures the reset boundary is consistent regardless of
 * where the server process happens to be running.
 * @returns {string}
 */
function getTodayString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

/**
 * Build the Redis key for a given user for today.
 * The date component ensures the counter resets automatically each day.
 * @param {string} userId
 * @returns {string}
 */
function buildKey(userId) {
  return `${userId}:${getTodayString()}`;
}

/**
 * Retrieve stored usage data for a user for today.
 * Returns a fresh zeroed record when no data is found.
 *
 * @param {string} userId
 * @returns {Promise<{ messages_used: number, images_used: number, videos_used: number, uploads_used: number }>}
 */
async function getUsage(userId) {
  const raw = await redis.command('GET', buildKey(userId));
  if (!raw) {
    return { messages_used: 0, images_used: 0, videos_used: 0, uploads_used: 0 };
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      messages_used: Number(parsed.messages_used) || 0,
      images_used:   Number(parsed.images_used)   || 0,
      videos_used:   Number(parsed.videos_used)   || 0,
      uploads_used:  Number(parsed.uploads_used)  || 0
    };
  } catch (e) {
    return { messages_used: 0, images_used: 0, videos_used: 0, uploads_used: 0 };
  }
}

/**
 * Persist usage data back to Redis with a rolling TTL.
 *
 * @param {string} userId
 * @param {{ messages_used: number, images_used: number, videos_used: number, uploads_used: number }} data
 * @returns {Promise<void>}
 */
async function saveUsage(userId, data) {
  const key = buildKey(userId);
  // Use a single atomic SET … EX command so the TTL is always applied even
  // if the process exits immediately after writing the value.
  await redis.command('SET', key, JSON.stringify(data), 'EX', USAGE_TTL_SECONDS);
}

/**
 * Validate a usage request against the plan limits, increment the counter on
 * success, and persist the updated data to Redis.
 *
 * @param {string} userId     - Unique identifier for the user or session
 * @param {string} plan       - Plan name: 'starter' | 'basic' | 'premium' | 'ultimate'
 * @param {string} actionType - Action being tracked: 'message' | 'image' | 'video' | 'upload'
 * @returns {Promise<{ allowed: boolean, error?: string }>}
 *   allowed: true when the request is within limits; false when the daily cap is reached
 */
async function checkAndTrack(userId, plan, actionType) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

  // Map actionType to its counter and limit fields
  const fieldMap = {
    message: { used: 'messages_used', limit: 'messages_per_day' },
    image:   { used: 'images_used',   limit: 'images_per_day'   },
    video:   { used: 'videos_used',   limit: 'videos_per_day'   },
    upload:  { used: 'uploads_used',  limit: 'uploads_per_day'  }
  };

  const fields = fieldMap[actionType];
  if (!fields) {
    // Unknown action type — allow the request rather than blocking it
    return { allowed: true };
  }

  const data = await getUsage(userId);

  const cap = limits[fields.limit];

  // null means unlimited
  if (cap === null) {
    data[fields.used] += 1;
    await saveUsage(userId, data);
    return { allowed: true };
  }

  if (data[fields.used] >= cap) {
    return {
      allowed: false,
      error: 'Daily limit reached. Upgrade your plan or wait for the reset.'
    };
  }

  data[fields.used] += 1;
  await saveUsage(userId, data);
  return { allowed: true };
}

module.exports = { checkAndTrack, getUsage, PLAN_LIMITS, getTodayString };
