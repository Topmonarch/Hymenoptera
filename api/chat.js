// api/chat.js — Vercel serverless handler for /api/chat

// Accepts POST { messages: [...] }, calls OpenAI Responses API.
// Always returns JSON. On success: { reply: assistantText }
// On error: { error: { message: string } }

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const { messages } = req.body || {};

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: { message: 'messages array required' } });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: messages
      })
    });

    let openaiData;
    try {
      openaiData = await response.json();
    } catch (e) {
      return res.status(502).json({ error: { message: 'Invalid response from upstream' } });
    }

    if (!response.ok) {
      const upstreamError = (openaiData && openaiData.error) ? openaiData.error : { message: 'Upstream error' };
      return res.status(502).json({ error: upstreamError });
    }

    // Extract assistant text with multiple fallbacks:
    // 1. output_text (Responses API convenience field)
    // 2. output[].content (Responses API output array)
    // 3. choices[].message.content (legacy Chat Completions fallback)
    let assistantText;

    if (openaiData.output_text) {
      assistantText = openaiData.output_text;
    } else if (Array.isArray(openaiData.output)) {
      for (const item of openaiData.output) {
        if (item && item.content) {
          assistantText = Array.isArray(item.content)
            ? item.content.map((c) => (c && c.text) ? c.text : String(c)).join('')
            : String(item.content);
          break;
        }
      }
    } else if (Array.isArray(openaiData.choices) && openaiData.choices[0] && openaiData.choices[0].message) {
      assistantText = openaiData.choices[0].message.content;
    }

    if (!assistantText) {
      return res.status(502).json({ error: { message: 'Unexpected response structure from upstream' } });
    }

    return res.status(200).json({ reply: assistantText });
  } catch (err) {
    console.error('api/chat error:', err);
    return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
  }
};
