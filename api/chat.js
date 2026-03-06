// api/chat.js
// Serverless function for the /api/chat endpoint.
// Accepts POST { messages: [...] }, sends the latest user message to the
// OpenAI Responses API, and returns { reply: assistantText }.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const body = req.body || {};
  const messages = body.messages;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'messages array is required' } });
  }

  // Find the latest user message
  let userText = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && messages[i].content) {
      userText = messages[i].content;
      break;
    }
  }

  if (!userText) {
    return res.status(400).json({ error: { message: 'No user message found in messages array' } });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'OpenAI API key is not configured' } });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        input: userText,
      }),
    });

    const data = await openaiRes.json();

    if (!openaiRes.ok) {
      const errMsg = (data && data.error && data.error.message) ? data.error.message : 'OpenAI request failed';
      return res.status(openaiRes.status).json({ error: { message: errMsg } });
    }

    // output_text is the convenience field on the Responses API response.
    // Fall back to extracting text from output[].content[].text if needed.
    let assistantText = (data && data.output_text) ? data.output_text : '';
    if (!assistantText && data && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part && part.text) {
              assistantText += part.text;
            }
          }
        }
      }
    }
    return res.status(200).json({ reply: assistantText });
  } catch (err) {
    console.error('api/chat error:', err);
    return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
  }
};
