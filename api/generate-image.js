// api/generate-image.js — Vercel serverless handler for /api/generate-image
//
// Accepts POST { prompt, userId, plan, sessionId, size, quality,
//                referenceImages, hasReferenceImage }
//   prompt           : text description / scene instructions (string, required)
//   userId           : authenticated user ID or 'guest' (string, optional)
//   plan             : subscription plan name (string, optional)
//   sessionId        : anonymous session ID (string, optional)
//   size             : image size — '1024x1024' | '1792x1024' | '1024x1792' (optional)
//   quality          : 'standard' | 'hd' (string, optional)
//   referenceImages  : array of { data: string, mimeType: string } — uploaded reference
//                      images to convert when generating (optional)
//   hasReferenceImage: boolean — explicit flag to indicate a reference image is present
//
// The endpoint uses two internal routes:
//   text_to_image_route   — called when no reference image is provided; generates from
//                           the text prompt alone using DALL-E 3.
//   image_to_image_route  — called when at least one reference image is uploaded;
//                           converts the drawing to a realistic image using SDXL on
//                           Replicate with strength=0.7. Base64 images are sent
//                           directly to Replicate via the model endpoint
//                           (/v1/models/stability-ai/sdxl/predictions) so the latest
//                           model version is always used without a hard-coded hash.
//
// The endpoint:
//   1. Validates the request fields.
//   2. Checks the daily image generation quota via usageLimits.
//   3. Detects whether a reference image is present and routes accordingly.
//   4. Returns { imageUrl: "<url>", revisedPrompt: "<text>" } as JSON.
//
// The existing /api/chat endpoint is NOT modified.

'use strict';

console.log('API loaded');

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

// Maximum characters accepted by the DALL-E 3 prompt field.
const DALLE3_MAX_PROMPT_LENGTH = 4000;

// Pattern for validating data URLs containing base64-encoded images.
// Used in multiple places; defined once here to ensure consistency.
const DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

/**
 * text_to_image_route — generates an image from a text prompt only.
 * Called when no reference image is provided.
 *
 * @param {{ apiKey: string, safePrompt: string, resolvedSize: string, resolvedQuality: string }} params
 * @returns {Promise<{ imageUrl: string, revisedPrompt: string }>}
 */
async function generateImageFromText(params) {
  const { apiKey, safePrompt, resolvedSize, resolvedQuality } = params;
  const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
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
    const err = new Error('Image generation service error');
    err.statusCode = 502;
    err.errorBody = (errData && errData.error) || { message: err.message };
    throw err;
  }

  const openaiData = await openaiRes.json();
  const imageData = openaiData.data && openaiData.data[0];
  if (!imageData || !imageData.url) {
    const err = new Error('No image returned from generation service');
    err.statusCode = 502;
    err.errorBody = { message: err.message };
    throw err;
  }

  return { imageUrl: imageData.url, revisedPrompt: imageData.revised_prompt || safePrompt };
}

/**
 * image_to_image_route — converts a drawing into a realistic image using SDXL
 * on Replicate.  Sends the base64 image directly to Replicate (no intermediate
 * upload), polls until complete (up to 60 s), and returns the result URL.
 *
 * @param {{ refImageList: Array }} params
 * @returns {Promise<{ imageUrl: string, revisedPrompt: string }>}
 */
async function generateImageWithReference(params) {
  const { refImageList } = params;

  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error('REPLICATE_API_TOKEN is not configured');
  }

  const finalPrompt = 'Turn this drawing into a realistic image. Keep the same design. Add realistic materials, lighting, and depth.';
  const strength = 0.7;

  console.log('[GENERATION] mode=image_to_image');
  console.log('[GENERATION] strength=' + strength);
  console.log('[GENERATION] prompt=', finalPrompt);

  // Build base64 data URL from reference image and send directly to Replicate.
  const base64DataUrl = refImageList[0].data.startsWith('data:')
    ? refImageList[0].data
    : `data:${refImageList[0].mimeType || 'image/png'};base64,${refImageList[0].data}`;

  console.log('[GENERATION] Sending base64 image directly to Replicate');

  // Use the model endpoint instead of a version hash so the latest SDXL
  // model is always used without needing to update a hard-coded SHA.
  const replicateRes = await fetch('https://api.replicate.com/v1/models/stability-ai/sdxl/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: {
        prompt: finalPrompt,
        image: base64DataUrl,
        strength: strength
      }
    })
  });

  const replicateBodyText = await replicateRes.text();
  console.log('[REPLICATE] HTTP status:', replicateRes.status);
  console.log('[REPLICATE] Response body:', replicateBodyText);

  if (!replicateRes.ok) {
    throw new Error(`Replicate API request failed with status ${replicateRes.status}: ${replicateBodyText}`);
  }

  let prediction;
  try {
    prediction = JSON.parse(replicateBodyText);
  } catch (e) {
    throw new Error(`Failed to parse Replicate response: ${replicateBodyText}`);
  }

  if (!prediction.urls || !prediction.urls.get) {
    console.error('[REPLICATE] Full response (missing polling URL):', JSON.stringify(prediction, null, 2));
    throw new Error('Replicate prediction did not return a polling URL. Full response: ' + JSON.stringify(prediction));
  }

  // Poll for completion (max 60 seconds)
  const pollUrl = prediction.urls.get;

  const TIMEOUT_MS = 60000;
  const POLL_INTERVAL_MS = 2000; // 2 s keeps log noise low while staying responsive
  const deadline = Date.now() + TIMEOUT_MS;

  let result = prediction;
  while (result.status !== 'succeeded' && result.status !== 'failed' && result.status !== 'canceled') {
    if (Date.now() >= deadline) {
      throw new Error('Replicate prediction timed out after 60 seconds');
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    const pollRes = await fetch(pollUrl, {
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`
      }
    });
    result = await pollRes.json();
    console.log('[REPLICATE] Prediction status:', result.status);
  }

  if (result.status !== 'succeeded') {
    throw new Error(`Replicate prediction failed with status: ${result.status}`);
  }

  const imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
  if (!imageUrl) {
    throw new Error('Replicate prediction succeeded but returned no output image URL');
  }

  console.log('[GENERATION] Result image URL:', imageUrl);

  return {
    imageUrl,
    revisedPrompt: finalPrompt
  };
}

// ── Vercel serverless handler ─────────────────────────────────────────────────

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
      quality,
      referenceImages,
      hasReferenceImage
    } = req.body || {};

    // ── Input validation ──────────────────────────────────────────────────────

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: { message: 'prompt (string) is required' } });
    }

    // Sanitize prompt: trim whitespace and limit to DALL-E 3 max length.
    const safePrompt = prompt.trim().slice(0, DALLE3_MAX_PROMPT_LENGTH);

    // Resolve size: use the provided value if valid, otherwise default.
    const resolvedSize = ALLOWED_SIZES.includes(size) ? size : '1024x1024';

    // Resolve quality: use the provided value if valid, otherwise default.
    const resolvedQuality = ALLOWED_QUALITY.includes(quality) ? quality : 'standard';

    // ── Daily image generation quota ──────────────────────────────────────────

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

    // ── Reference image resolution ────────────────────────────────────────────
    // Normalize the reference images list.
    const refImageList = [];
    if (Array.isArray(referenceImages) && referenceImages.length > 0) {
      referenceImages.forEach(function (img) {
        if (
          img &&
          typeof img === 'object' &&
          typeof img.data === 'string' &&
          img.data.length > 0 &&
          (DATA_URL_PATTERN.test(img.data) || /^[A-Za-z0-9+/]/.test(img.data))
        ) {
          refImageList.push(img);
        }
      });
    }

    // hasReferenceImage can be set explicitly or derived from the images list.
    const hasRefImages = refImageList.length > 0 || hasReferenceImage === true;

    // ── OpenAI API key ────────────────────────────────────────────────────────

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    // ── Route to appropriate generation path ──────────────────────────────────

    let imageUrl, revisedPrompt;

    if (!hasRefImages) {
      // text_to_image_route — no reference image
      const result = await generateImageFromText({ apiKey, safePrompt, resolvedSize, resolvedQuality });
      imageUrl = result.imageUrl;
      revisedPrompt = result.revisedPrompt;
    } else {
      // image_to_image_route — reference image present
      const result = await generateImageWithReference({ refImageList });
      imageUrl = result.imageUrl;
      revisedPrompt = result.revisedPrompt;
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ imageUrl, revisedPrompt });

  } catch (err) {
    console.error('api/generate-image error:', err);
    const statusCode = err.statusCode || 500;
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(statusCode).json({
        error: err.errorBody || { message: err.message || 'Internal server error' }
      });
    }
  }
};
