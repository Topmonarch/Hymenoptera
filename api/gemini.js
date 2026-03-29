// api/gemini.js — Vercel serverless handler for /api/gemini
//
// Accepts POST { prompt }.
// Calls Google Gemini (gemini-1.5-flash) and returns { text: response }.
// Uses GEMINI_API_KEY from environment variables (never exposed to the frontend).
//
// This is an additional AI provider endpoint and does not replace any
// existing OpenAI or other provider calls.

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt } = req.body || {};

    if (!prompt) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const generation = await model.generateContent(prompt);
    const response = await generation.response;

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ text: response.text() });
  } catch (error) {
    console.error('Gemini error:', error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({
      error: 'Gemini request failed',
      details: error.message,
    });
  }
};
