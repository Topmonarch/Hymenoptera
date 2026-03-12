// server/queue.js — In-memory request queue for AI request concurrency management
//
// Limits how many OpenAI requests run simultaneously (MAX_CONCURRENT_REQUESTS).
// When the limit is reached, new requests wait in the queue until a slot is freed.
// This prevents server overload during traffic spikes.

const MAX_CONCURRENT_REQUESTS = 5;

// Number of requests currently being processed by workers
let activeCount = 0;

// Pending requests waiting for a free concurrency slot
const waitQueue = [];

/**
 * Enqueue an AI request.
 *
 * Resolves immediately when a concurrency slot is available; otherwise the
 * request waits in the queue until a previous request calls releaseSlot().
 *
 * @param {Object} requestData
 * @param {string} [requestData.userId]    - ID of the requesting user
 * @param {string} [requestData.chatId]    - ID of the conversation
 * @param {Array}  [requestData.messages]  - Message array for the AI request
 * @param {string} [requestData.agentType] - Agent: general | coding | research | business | robotics
 * @returns {Promise<Object>} Resolves with the queued item when a slot is acquired
 */
function enqueueRequest(requestData) {
  return new Promise((resolve, reject) => {
    const item = {
      userId: requestData.userId || null,
      chatId: requestData.chatId || null,
      messages: requestData.messages || [],
      agentType: requestData.agentType || 'general',
      timestamp: Date.now(),
      // resolve/reject are kept for potential future timeout or cancellation support
      resolve,
      reject
    };

    if (activeCount < MAX_CONCURRENT_REQUESTS) {
      activeCount++;
      resolve(item);
    } else {
      waitQueue.push(item);
    }
  });
}

/**
 * Release a concurrency slot after a request completes (success or failure).
 * Dispatches the next waiting item from the queue if one exists.
 */
function releaseSlot() {
  if (activeCount <= 0) {
    console.warn('server/queue: releaseSlot called with no active requests — possible mismatched acquire/release');
    return;
  }
  activeCount--;
  if (waitQueue.length > 0) {
    const next = waitQueue.shift();
    activeCount++;
    next.resolve(next);
  }
}

/**
 * Return current queue status (useful for monitoring / debugging).
 *
 * @returns {{ queued: number, active: number, maxConcurrent: number }}
 */
function getQueueStatus() {
  return {
    queued: waitQueue.length,
    active: activeCount,
    maxConcurrent: MAX_CONCURRENT_REQUESTS
  };
}

module.exports = { enqueueRequest, releaseSlot, getQueueStatus, MAX_CONCURRENT_REQUESTS };
