// api/chat.js
// Vercel serverless function — backend endpoint for the Hymenoptera chat.
// Receives: POST { messages: [{ role: "user", content: "..." }] }
// Calls the OpenAI Responses API and returns: { reply: "assistant text" }

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  const { messages } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: { message: 'Invalid request: messages array is required.' } });
  }

  // Build the input for the OpenAI Responses API.
  // The Responses API accepts a flat string or a structured messages array.
  // We pass the messages array directly so conversation context is preserved.
  const input = messages.map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: String(m.content || '')
  }));

  try {
    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: input
    });

    const assistantText = response.output_text;

    if (typeof assistantText !== 'string') {
      return res.status(500).json({ error: { message: 'Unexpected response format from OpenAI.' } });
    }

    return res.status(200).json({ reply: assistantText });
  } catch (err) {
    console.error('OpenAI API error:', err);
    const message = (err && err.message) ? err.message : 'OpenAI API error';
    return res.status(500).json({ error: { message } });
  }
};
