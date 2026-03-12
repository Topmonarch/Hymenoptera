// lib/aiWorker.js — Redis-backed AI request worker with distributed rate protection
//
// Provides processWithRedis(), which:
//   1. Records the incoming request in the Redis queue for observability.
//   2. Acquires a distributed concurrency slot using a Redis INCR counter.
//      If MAX_CONCURRENT_AI_REQUESTS slots are already taken the call is rejected
//      so the caller can fall back to the existing in-memory worker.
//   3. Calls the OpenAI Chat Completions API.
//   4. Releases the concurrency slot in a finally block so the counter is
//      always decremented even if OpenAI returns an error or the function throws.
//
// A TTL is set on the concurrency counter key as a safety measure: if a
// serverless instance exits before releasing its slot (e.g. hard timeout), the
// counter will automatically expire and reset rather than blocking indefinitely.
//
// MAX_CONCURRENT_AI_REQUESTS = 3  (as required by the specification)

'use strict';

const { redis } = require('./redis');
const { enqueueAIRequest } = require('./aiQueue');

const CONCURRENCY_KEY = 'ai_active_requests';
const MAX_CONCURRENT_AI_REQUESTS = 3;

// Safety TTL (seconds): if the key is not decremented back to zero within this
// window (e.g. due to a crashed function), Redis will expire it automatically.
const SLOT_TTL_SECONDS = 120;

/**
 * Attempt to acquire one distributed concurrency slot.
 *
 * Uses INCR to atomically increment the counter, then checks whether the new
 * value exceeds the limit.  If it does, the increment is immediately reversed
 * with DECR so the counter stays accurate.
 *
 * @returns {Promise<boolean>} true when a slot was acquired, false when at capacity
 */
async function acquireRedisSlot() {
  const current = await redis.command('INCR', CONCURRENCY_KEY);
  const count = typeof current === 'number' ? current : parseInt(current, 10);

  if (count > MAX_CONCURRENT_AI_REQUESTS) {
    // Over limit — give the slot back immediately
    await redis.command('DECR', CONCURRENCY_KEY);
    return false;
  }

  // Refresh the safety TTL on every successful acquisition so it only
  // fires when all slots have been idle for the full window.
  // If EXPIRE fails, abort the acquisition so that a stuck counter never
  // permanently blocks all future requests.
  await redis.command('EXPIRE', CONCURRENCY_KEY, SLOT_TTL_SECONDS);

  return true;
}

/**
 * Release one distributed concurrency slot.
 * Guards against the counter going below zero due to unexpected double-release.
 */
async function releaseRedisSlot() {
  const current = await redis.command('DECR', CONCURRENCY_KEY);
  const count = typeof current === 'number' ? current : parseInt(current, 10);
  if (count < 0) {
    // Counter went negative — delete the key entirely so the next INCR
    // starts cleanly from 0.  DEL is safer than SET here: multiple concurrent
    // callers all issuing DEL is idempotent, while concurrent SET 0 calls could
    // mask each other and leave the counter in an unknown state.
    await redis.command('DEL', CONCURRENCY_KEY);
  }
}

/**
 * Process an AI request through the Redis queue and distributed concurrency gate.
 *
 * @param {Object}  params
 * @param {Array}   params.apiMessages   - Full message array to send to OpenAI
 * @param {string}  params.apiKey        - OpenAI API key
 * @param {string}  params.selectedModel - OpenAI model identifier (e.g. 'gpt-4o')
 * @param {boolean} [params.stream]      - Whether to request a streaming response (default: false)
 * @param {string}  [params.userId]      - ID of the requesting user
 * @param {string}  [params.chatId]      - ID of the conversation
 * @param {string}  [params.agentType]   - Agent type: general | coding | research | business | robotics
 * @returns {Promise<Response>} The raw fetch Response from OpenAI
 * @throws {Error} If Redis is at capacity or if the OpenAI fetch fails
 */
async function processWithRedis({ apiMessages, apiKey, selectedModel, stream = false, userId, chatId, agentType }) {
  // Record request metadata in the Redis queue list for observability.
  // This is best-effort — a failure here must not prevent the AI call.
  try {
    const lastMessage = Array.isArray(apiMessages) && apiMessages.length > 0
      ? apiMessages[apiMessages.length - 1]
      : null;
    await enqueueAIRequest({
      userId,
      chatId,
      message: lastMessage ? lastMessage.content : '',
      agentType
    });
  } catch (e) {
    // Queue metadata recording is non-fatal
  }

  // Acquire a distributed concurrency slot
  const slotAcquired = await acquireRedisSlot();
  if (!slotAcquired) {
    throw new Error('Redis queue at capacity — falling back to in-memory queue');
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: apiMessages,
        stream
      })
    });

    return response;
  } finally {
    // Always release the slot regardless of success or failure
    try {
      await releaseRedisSlot();
    } catch (e) {
      // Slot release failure is logged but must not mask the original error
      console.error('lib/aiWorker: failed to release Redis slot:', e.message);
    }
  }
}

module.exports = { processWithRedis, MAX_CONCURRENT_AI_REQUESTS };
