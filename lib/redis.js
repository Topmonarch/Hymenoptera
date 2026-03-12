// lib/redis.js — Upstash Redis client using the REST API
//
// Provides a lightweight Redis interface backed by Upstash's HTTP REST API.
// No npm package is required — all communication is done via the native fetch API
// that is available in the Vercel Node.js 18+ runtime.
//
// Credentials are read from environment variables:
//   UPSTASH_REDIS_REST_URL   — base URL of the Upstash Redis REST endpoint
//   UPSTASH_REDIS_REST_TOKEN — bearer token for authentication

'use strict';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * Execute a Redis command via the Upstash REST API.
 *
 * @param {...string|number} args - Command and its arguments, e.g. ('LPUSH', 'mylist', 'value')
 * @returns {Promise<*>} The `result` field from the Upstash JSON response
 * @throws {Error} If credentials are missing, the HTTP request fails, or Redis returns an error
 */
async function redisCommand(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) {
    throw new Error('Redis credentials not configured (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)');
  }

  // Build the URL path: each argument is percent-encoded and joined with slashes.
  // Upstash REST API format: POST /{COMMAND}/{arg1}/{arg2}/...
  const path = args.map(a => encodeURIComponent(String(a))).join('/');
  const response = await fetch(`${REDIS_URL}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
  });

  if (!response.ok) {
    throw new Error(`Redis HTTP error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`Redis error: ${data.error}`);
  }

  return data.result;
}

/**
 * Reusable Redis instance exposing a single `command` helper.
 * Additional convenience methods can be added here as needed.
 */
const redis = {
  /**
   * Execute any Redis command.
   * @param {...string|number} args - Command name followed by its arguments
   * @returns {Promise<*>}
   */
  command: redisCommand
};

module.exports = { redis };
