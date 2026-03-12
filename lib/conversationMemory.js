// lib/conversationMemory.js — Redis-backed conversation history helper
//
// Stores per-session conversation history in Redis so the AI can reference
// previous messages when generating a reply.
//
// Key format : conversation:{sessionId}
// Stored value: JSON array of { role, content } message objects
// History is capped at MAX_HISTORY messages to keep token usage manageable.
//
// All functions degrade gracefully: callers should wrap them in try/catch so
// that a Redis outage never breaks the core chat flow.

'use strict';

const { redis } = require('./redis');

const MAX_HISTORY = 20;

const CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Build the Redis key for a given session.
 * @param {string} sessionId
 * @returns {string}
 */
function buildKey(sessionId) {
  return `conversation:${sessionId}`;
}

/**
 * Retrieve the stored conversation for a session.
 *
 * @param {string} sessionId - Unique identifier for the conversation session
 * @returns {Promise<Array>} Array of { role, content } message objects, or [] if none stored
 */
async function getConversation(sessionId) {
  const raw = await redis.command('GET', buildKey(sessionId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

/**
 * Persist a conversation array back to Redis, trimmed to MAX_HISTORY messages.
 *
 * @param {string} sessionId - Unique identifier for the conversation session
 * @param {Array}  messages  - Full array of { role, content } message objects
 * @returns {Promise<void>}
 */
async function saveConversation(sessionId, messages) {
  const trimmed = messages.slice(-MAX_HISTORY);
  const key = buildKey(sessionId);
  await redis.command('SET', key, JSON.stringify(trimmed));
  // Set a TTL so old sessions are cleaned up automatically and Redis memory stays bounded
  await redis.command('EXPIRE', key, CONVERSATION_TTL_SECONDS);
}

/**
 * Append a single message to the stored conversation and persist it.
 *
 * @param {string} sessionId - Unique identifier for the conversation session
 * @param {Object} message   - Message object: { role: 'user'|'assistant', content: string }
 * @returns {Promise<Array>} The updated (and trimmed) conversation array
 */
async function appendMessage(sessionId, message) {
  const history = await getConversation(sessionId);
  history.push(message);
  await saveConversation(sessionId, history);
  return history.slice(-MAX_HISTORY);
}

module.exports = { getConversation, appendMessage, saveConversation };
