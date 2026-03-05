// api/chat.js
// Server handler for POST /api/chat
// Expects JSON body: { messages: [{ role: 'user'|'assistant', content: '...' }, ...] }

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body || {};
    const messages = Array.isArray(body.messages) ? body.messages : [];

    // Normalize conversation for the Responses API
    const conversation = messages.map((m) => {
      return { role: m.role, content: m.content };
    });

    if (!process.env.OPENAI_API_KEY) {
      console.error('Missing OPENAI_API_KEY in environment');
      return res.status(500).json({ error: 'Server misconfiguration: missing API key' });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({ model: 'gpt-4o-mini', input: conversation, stream: false })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('OpenAI API error:', data);
      // Return the provider error message (but don't leak secret)
      return res.status(response.status).json({ error: data });
    }

    // Try several ways to extract a readable assistant reply from Responses API
    let reply = '';

    // 1) Common top-level convenience field
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      reply = data.output_text.trim();
    }

    // 2) data.output array with content blocks
    if (!reply && Array.isArray(data.output)) {
      reply = data.output
        .map((out) => {
          if (typeof out === 'string') return out;
          if (Array.isArray(out.content)) {
            return out.content.map((c) => c.text || c.type === 'output_text' && c.text || '').join('');
          }
          return '';
        })
        .join('\n')
        .trim();
    }

    // 3) older "choices" / chat-completion-like shapes
    if (!reply && Array.isArray(data.choices) && data.choices.length > 0) {
      const choice = data.choices[0];
      if (choice.message && choice.message.content) {
        if (Array.isArray(choice.message.content)) {
          reply = choice.message.content.map((c) => c.text || '').join('').trim();
        } else if (typeof choice.message.content === 'string') {
          reply = choice.message.content.trim();
        } else if (choice.message.content.parts) {
          reply = choice.message.content.parts.join('').trim();
        }
      } else if (choice.text) {
        reply = (choice.text || '').trim();
      }
    }

    // Fallback: stringify whatever was returned (helps debugging)
    if (!reply) reply = JSON.stringify(data);

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
}