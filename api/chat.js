// api/chat.js — Vercel serverless handler for /api/chat

// Accepts POST { messages: [...], agent, systemPrompt, model }.
// messages contains the full conversation history (user + assistant turns).
// The system prompt is prepended so the agent persona is applied on every request.
// Streams the OpenAI Chat Completions response back as Server-Sent Events (SSE).
// Each SSE event is forwarded directly from OpenAI.
// On early errors (before streaming begins): returns JSON { error: { message } }.

// All OpenAI requests are routed through the queue/worker layer so that at most
// MAX_CONCURRENT_REQUESTS are in-flight at once, improving scalability under load.
const { processRequest: _workerProcessRequest } = require('../server/worker');

// Redis-backed worker is loaded lazily so that a missing lib/ directory or
// misconfigured Redis credentials never break the existing request flow.
let _redisProcessWithRedis = null;
try { _redisProcessWithRedis = require('../lib/aiWorker').processWithRedis; } catch (e) { console.warn('api/chat: Redis worker unavailable, using in-memory queue:', e.message); }

/**
 * Route an AI request through the Redis queue when available, with automatic
 * fallback to the existing in-memory concurrency queue if Redis is unavailable
 * or returns an error.
 */
async function processRequest(params) {
  if (_redisProcessWithRedis) {
    try {
      return await _redisProcessWithRedis(params);
    } catch (e) {
      // Redis path failed (unavailable, at capacity, network error, etc.) —
      // fall through to the reliable in-memory queue below.
    }
  }
  return _workerProcessRequest(params);
}

async function webSearch(query) {
  const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_redirect=1&no_html=1';
  const response = await fetch(url);
  if (!response.ok) {
    return '';
  }
  let data;
  try {
    data = await response.json();
  } catch (e) {
    return '';
  }
  return (data && data.AbstractText) || '';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const { messages, systemPrompt, agent, model, hiveMode, fileContext, image, webAccess } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: { message: 'messages array required' } });
    }

    const fallbackPrompts = {
      general: 'You are a helpful AI assistant.',
      coding: 'You are a professional software engineer that writes and explains code clearly.',
      research: 'You are an academic researcher who explains complex topics clearly.',
      business: 'You are a startup strategist and marketing advisor.',
      robotics: 'You are a robotics and automation engineering expert.'
    };

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    const modelMap = {
      fast: 'gpt-4o-mini',
      smart: 'gpt-4o',
      coding: 'gpt-4o'
    };
    const selectedModel = modelMap[model] || 'gpt-4o';

    if (!hiveMode) {
      const resolvedSystemPrompt = systemPrompt || fallbackPrompts[agent] || fallbackPrompts.general;

      // Perform web search if webAccess is enabled and the Research Agent is active.
      let webResults = '';
      if (webAccess && agent === 'research') {
        const latestUserMessage = messages[messages.length - 1] && messages[messages.length - 1].content;
        if (latestUserMessage) {
          try {
            webResults = await webSearch(latestUserMessage);
          } catch (e) {
            // Web search failure is non-fatal; proceed without results
          }
        }
      }

      // Build the full message list: system prompt first, then the complete conversation history.
      // Placing the system prompt at position 0 ensures the agent persona is always in effect.
      // The spread of messages sends every prior user + assistant turn so the AI remembers context.
      const apiMessages = [
        { role: 'system', content: resolvedSystemPrompt },
        ...(fileContext && fileContext.length > 0 ? [{ role: 'system', content: 'The following document was uploaded by the user. Use it as reference when answering:\n\n' + fileContext }] : []),
        ...(image ? [{ role: 'system', content: 'The user has uploaded an image. Analyze the image when responding.' }] : []),
        ...(webResults ? [{ role: 'system', content: 'WEB SEARCH RESULTS:\n' + webResults }] : []),
        ...messages
      ];

      // Send the full conversation history (system prompt + all prior turns) to OpenAI.
      // This gives the model the complete context it needs to produce a coherent reply.
      // The call is routed through the worker queue to limit concurrent OpenAI requests.
      const upstream = await processRequest({
        apiMessages,
        apiKey,
        selectedModel,
        stream: true,
        agentType: agent
      });

      if (!upstream.ok) {
        let errorData;
        try {
          errorData = await upstream.json();
        } catch (e) {
          errorData = { error: { message: 'Upstream error' } };
        }
        res.setHeader('Content-Type', 'application/json');
        return res.status(502).json({ error: (errorData && errorData.error) || { message: 'Upstream error' } });
      }

      // Stream SSE events from OpenAI directly to the client
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }

      res.end();
    } else {
      // Hive Mode: run multiple agents and combine their responses
      const hiveAgents = {
        research: 'You are a research specialist providing analytical insights.',
        business: 'You are a business strategist providing startup and market advice.',
        coding: 'You are a senior software engineer providing technical implementation.',
        robotics: 'You are a robotics engineer providing automation and hardware ideas.'
      };

      const hiveAgentLabels = {
        research: 'Research Agent',
        business: 'Business Agent',
        coding: 'Coding Agent',
        robotics: 'Robotics Agent'
      };

      // When webAccess is enabled, have the Research Agent gather live web data
      // and share those results with all hive agents.
      let hiveWebResults = '';
      if (webAccess) {
        const latestUserMessage = messages[messages.length - 1] && messages[messages.length - 1].content;
        if (latestUserMessage) {
          try {
            hiveWebResults = await webSearch(latestUserMessage);
          } catch (e) {
            // Web search failure is non-fatal; proceed without results
          }
        }
      }

      async function callAgent(agentName) {
        const agentMessages = [
          { role: 'system', content: hiveAgents[agentName] },
          ...(fileContext && fileContext.length > 0 ? [{ role: 'system', content: 'The following document was uploaded by the user. Use it as reference when answering:\n\n' + fileContext }] : []),
          ...(image ? [{ role: 'system', content: 'The user has uploaded an image. Analyze the image when responding.' }] : []),
          ...(hiveWebResults ? [{ role: 'system', content: 'The following web research results are available:\n' + hiveWebResults }] : []),
          ...messages
        ];
        // Route hive-mode agent calls through the worker queue to limit concurrency.
        const upstream = await processRequest({
          apiMessages: agentMessages,
          apiKey,
          selectedModel,
          stream: false,
          agentType: agentName
        });
        if (!upstream.ok) {
          return '[Error from ' + hiveAgentLabels[agentName] + ': HTTP ' + upstream.status + ']';
        }
        const data = await upstream.json();
        return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '[No response]';
      }

      const agentKeys = ['research', 'business', 'coding', 'robotics'];
      const results = await Promise.allSettled(agentKeys.map(callAgent));

      const combined = agentKeys.map(function (key, i) {
        const result = results[i];
        const text = result.status === 'fulfilled' ? result.value : '[Error from ' + hiveAgentLabels[key] + ']';
        return hiveAgentLabels[key] + ':\n' + text;
      }).join('\n\n');

      res.setHeader('Content-Type', 'application/json');
      return res.status(200).json({ content: combined });
    }
  } catch (err) {
    console.error('api/chat error:', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      const isNetworkError = err.cause || err.code || (err.message && err.message.includes('fetch'));
      const message = isNetworkError
        ? 'Failed to reach upstream AI service: ' + (err.message || 'network error')
        : (err.message || 'Internal server error');
      return res.status(500).json({ error: { message } });
    }
    res.end();
  }
};
