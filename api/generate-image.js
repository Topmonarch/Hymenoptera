// api/generate-image.js — Vercel serverless handler for /api/generate-image
//
// Accepts POST { prompt, userId, plan, sessionId, size, quality }
//   prompt    : text description of the image to generate (string, required)
//   userId    : authenticated user ID or 'guest' (string, optional)
//   plan      : subscription plan name (string, optional)
//   sessionId : anonymous session ID (string, optional)
//   size      : image size — '1024x1024' | '1792x1024' | '1024x1792' (string, optional)
//   quality   : 'standard' | 'hd' (string, optional)
//
// The endpoint:
//   1. Validates the request fields.
//   2. Checks the daily image generation quota via usageLimits.
//   3. Calls OpenAI DALL-E 3 to generate the image.
//   4. Returns { imageUrl: "<url>", revisedPrompt: "<text>" } as JSON.
//
// The existing /api/chat endpoint is NOT modified.

'use strict';

// Usage limits helper — loaded lazily so a missing / misconfigured module
// never blocks the image generation flow.
let _usageLimits = null;
try {
  _usageLimits = require('../lib/usageLimits');
} catch (e) {
  console.warn('api/generate-image: usage limits unavailable:', e.message);
}

// Allowed image sizes for DALL-E 3.
const ALLOWED_SIZES = ['1024x1024', '1792x1024', '1024x1792'];

// Allowed quality values for DALL-E 3.
const ALLOWED_QUALITY = ['standard', 'hd'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const {
      prompt,
      userId,
      plan,
      sessionId,
      size,
      quality
    } = req.body || {};

    // ── Input validation ────────────────────────────────────────────────────

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: { message: 'prompt (string) is required' } });
    }

    // Sanitize prompt: trim whitespace and limit length to avoid abuse.
    const safePrompt = prompt.trim().slice(0, 4000);

    const resolvedSize = ALLOWED_SIZES.includes(size) ? size : '1024x1024';
    const resolvedQuality = ALLOWED_QUALITY.includes(quality) ? quality : 'standard';

    // ── Daily image generation quota ────────────────────────────────────────

    if (_usageLimits) {
      const trackingId = (userId && userId !== 'guest') ? userId : sessionId;
      if (trackingId) {
        try {
          const KNOWN_PLANS = Object.keys(_usageLimits.PLAN_LIMITS);
          const rawPlan = typeof plan === 'string' ? plan.toLowerCase() : '';
          const userPlan = KNOWN_PLANS.includes(rawPlan) ? rawPlan : 'starter';
          const result = await _usageLimits.checkAndTrack(trackingId, userPlan, 'image');
          if (!result.allowed) {
            res.setHeader('Content-Type', 'application/json');
            return res.status(429).json({
              error: { message: result.error || 'Daily image generation limit reached. Upgrade your plan or wait for the reset.' }
            });
          }
        } catch (e) {
          // Usage limit check failure is non-fatal — let the request proceed.
          console.warn('api/generate-image: usage limit check failed:', e.message);
        }
      }
    }

    // ── OpenAI DALL-E 3 API call ────────────────────────────────────────────

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: safePrompt,
        n: 1,
        size: resolvedSize,
        quality: resolvedQuality,
        response_format: 'url'
      })
    });

    if (!openaiRes.ok) {
      let errData;
      try { errData = await openaiRes.json(); } catch (e) { errData = null; }
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({
        error: (errData && errData.error) || { message: 'Image generation service error' }
      });
    }

    const openaiData = await openaiRes.json();
    const imageData = openaiData.data && openaiData.data[0];
    if (!imageData || !imageData.url) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({ error: { message: 'No image returned from generation service' } });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      imageUrl: imageData.url,
      revisedPrompt: imageData.revised_prompt || safePrompt
    });
  } catch (err) {
    console.error('api/generate-image error:', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
  }
};
