// server/worker.js — Worker module for processing queued AI requests
//
// Routes every OpenAI API call through the queue so that at most
// MAX_CONCURRENT_REQUESTS requests are in-flight at the same time.
// If the limit is reached the call waits in the queue; when a slot
// becomes available the worker sends the request to OpenAI and returns
// the raw Response object to the caller.
//
// Failure handling: if the fetch throws or OpenAI returns an error, the
// slot is always released (via finally) so the queue never blocks permanently.

const { enqueueRequest, releaseSlot } = require('./queue');

/**
 * Process an AI request through the queue, calling OpenAI when a slot is available.
 *
 * @param {Object}  params
 * @param {Array}   params.apiMessages   - Full message array to send to OpenAI
 * @param {string}  params.apiKey        - OpenAI API key
 * @param {string}  params.selectedModel - OpenAI model identifier (e.g. 'gpt-4o')
 * @param {boolean} [params.stream]      - Whether to request a streaming response (default: false)
 * @param {string}  [params.userId]      - ID of the requesting user (for queue metadata)
 * @param {string}  [params.chatId]      - ID of the conversation (for queue metadata)
 * @param {string}  [params.agentType]   - Agent type: general | coding | research | business | robotics
 * @returns {Promise<Response>} The raw fetch Response from OpenAI
 */
async function processRequest({ apiMessages, apiKey, selectedModel, stream = false, userId, chatId, agentType }) {
  // Acquire a queue slot — waits if MAX_CONCURRENT_REQUESTS limit is reached
  await enqueueRequest({
    userId,
    chatId,
    messages: apiMessages,
    agentType: agentType || 'general'
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: apiMessages,
        stream
      })
    });

    return response;
  } finally {
    // Always release the slot so the queue never blocks permanently,
    // regardless of whether the request succeeded or failed.
    releaseSlot();
  }
}

module.exports = { processRequest };
