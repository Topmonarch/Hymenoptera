// api/chat.js — Vercel serverless handler for /api/chat
// Always returns JSON. On success: { reply: assistantText }
// On error: { error: { message: string } }

const https = require('https');

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

    const reqBody = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages
    });

    const openaiData = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'Content-Length': Buffer.byteLength(reqBody)
        }
      };

      const request = https.request(options, (response) => {
        let raw = '';
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('Invalid JSON from OpenAI'));
          }
        });
      });

      request.on('error', reject);
      request.write(reqBody);
      request.end();
    });

    if (openaiData.error) {
      return res.status(502).json({ error: openaiData.error });
    }

    if (!openaiData.choices || !openaiData.choices[0] || !openaiData.choices[0].message) {
      return res.status(502).json({ error: { message: 'Unexpected response structure from OpenAI' } });
    }

    const assistantText = openaiData.choices[0].message.content;
    return res.status(200).json({ reply: assistantText });
  } catch (err) {
    console.error('api/chat error:', err);
    return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
  }
};
