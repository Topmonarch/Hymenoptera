// lib/usageLimits.js — Daily usage limit helper
//
// Tracks per-user usage counters for messages, image generation, video
// generation, and file uploads. Counters are stored in Redis and reset
// automatically every 24 hours.
//
// Key format : usage:{userId}
// Stored value: JSON object with the structure described below.
//
// Usage data structure:
// {
//   messages_used : number,
//   images_used   : number,
//   videos_used   : number,
//   uploads_used  : number,
//   last_reset    : number  (Unix timestamp ms)
// }
//
// All functions degrade gracefully: callers should wrap them in try/catch so
// that a Redis outage never blocks the core chat flow.

'use strict';

const { redis } = require('./redis');

// TTL of 49 hours gives the key a little more life than the 24-hour reset
// window so that a user who returns just after the window ends still has a
// record to compare against rather than starting from zero.
const USAGE_TTL_SECONDS = 49 * 60 * 60;

const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Daily usage limits per plan.
 * null means unlimited.
 */
const PLAN_LIMITS = {
  starter: { messages_per_day: 30,  images_per_day: 5,   videos_per_day: 0,   uploads_per_day: 3   },
  basic:   { messages_per_day: 100, images_per_day: 50,  videos_per_day: 0,   uploads_per_day: 10  },
  premium: { messages_per_day: 500, images_per_day: 200, videos_per_day: 10,  uploads_per_day: 50  },
  ultimate:{ messages_per_day: null, images_per_day: null, videos_per_day: null, uploads_per_day: null }
};

/**
 * Build the Redis key for a given user.
 * @param {string} userId
 * @returns {string}
 */
function buildKey(userId) {
  return `usage:${userId}`;
}

/**
 * Retrieve stored usage data for a user.
 * Returns a fresh zeroed record when no data is found.
 *
 * @param {string} userId
 * @returns {Promise<{ messages_used: number, images_used: number, videos_used: number, uploads_used: number, last_reset: number }>}
 */
async function getUsage(userId) {
  const raw = await redis.command('GET', buildKey(userId));
  if (!raw) {
    return { messages_used: 0, images_used: 0, videos_used: 0, uploads_used: 0, last_reset: Date.now() };
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      messages_used: Number(parsed.messages_used) || 0,
      images_used:   Number(parsed.images_used)   || 0,
      videos_used:   Number(parsed.videos_used)   || 0,
      uploads_used:  Number(parsed.uploads_used)  || 0,
      last_reset:    Number(parsed.last_reset)    || Date.now()
    };
  } catch (e) {
    return { messages_used: 0, images_used: 0, videos_used: 0, uploads_used: 0, last_reset: Date.now() };
  }
}

/**
 * Persist usage data back to Redis with a rolling TTL.
 *
 * @param {string} userId
 * @param {{ messages_used: number, images_used: number, videos_used: number, uploads_used: number, last_reset: number }} data
 * @returns {Promise<void>}
 */
async function saveUsage(userId, data) {
  const key = buildKey(userId);
  // Use a single atomic SET … EX command so the TTL is always applied even
  // if the process exits immediately after writing the value.
  await redis.command('SET', key, JSON.stringify(data), 'EX', USAGE_TTL_SECONDS);
}

/**
 * Reset all counters on the usage object when 24 hours have elapsed.
 * Mutates the object in-place and returns it.
 *
 * @param {{ messages_used: number, images_used: number, videos_used: number, uploads_used: number, last_reset: number }} data
 * @returns {{ messages_used: number, images_used: number, videos_used: number, uploads_used: number, last_reset: number }}
 */
function resetIfNeeded(data) {
  const now = Date.now();
  if (now >= data.last_reset + RESET_INTERVAL_MS) {
    data.messages_used = 0;
    data.images_used   = 0;
    data.videos_used   = 0;
    data.uploads_used  = 0;
    data.last_reset    = now;
  }
  return data;
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
  resetIfNeeded(data);

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

module.exports = { checkAndTrack, getUsage, PLAN_LIMITS };
