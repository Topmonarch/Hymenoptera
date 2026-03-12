// lib/aiQueue.js — Redis-backed AI request queue utility
//
// Provides helpers to push AI request metadata into a Redis list and read
// queue status.  The queue is used for observability and replay potential;
// the actual OpenAI concurrency limit is enforced separately in aiWorker.js
// using a Redis counter (distributed semaphore).
//
// Redis key used for the queue list: ai_request_queue

'use strict';

const crypto = require('crypto');
const { redis } = require('./redis');

const QUEUE_KEY = 'ai_request_queue';

/**
 * Push an AI request descriptor onto the Redis queue list.
 *
 * @param {Object}  params
 * @param {string}  [params.userId]    - ID of the requesting user (may be null for guests)
 * @param {string}  [params.chatId]    - ID of the conversation
 * @param {string}  [params.message]   - The latest user message text
 * @param {string}  [params.agentType] - Agent type: general | coding | research | business | robotics
 * @returns {Promise<{ requestId: string, queued: boolean }>}
 */
async function enqueueAIRequest({ userId, chatId, message, agentType }) {
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');

  const payload = {
    requestId,
    userId: userId || null,
    chatId: chatId || null,
    message: typeof message === 'string' ? message.slice(0, 500) : '',
    agentType: agentType || 'general',
    timestamp: Date.now()
  };

  // LPUSH prepends to the list; RPOP in the worker retrieves in FIFO order.
  await redis.command('LPUSH', QUEUE_KEY, JSON.stringify(payload));

  return { requestId, queued: true };
}

/**
 * Pop the next pending request from the queue (FIFO).
 *
 * @returns {Promise<Object|null>} The parsed request payload, or null if the queue is empty
 */
async function dequeueAIRequest() {
  const item = await redis.command('RPOP', QUEUE_KEY);
  if (item === null || item === undefined) return null;
  return typeof item === 'string' ? JSON.parse(item) : item;
}

/**
 * Return the current number of items waiting in the queue.
 *
 * @returns {Promise<number>}
 */
async function getQueueLength() {
  const len = await redis.command('LLEN', QUEUE_KEY);
  return typeof len === 'number' ? len : parseInt(len, 10) || 0;
}

module.exports = { enqueueAIRequest, dequeueAIRequest, getQueueLength, QUEUE_KEY };
