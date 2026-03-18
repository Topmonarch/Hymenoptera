// api/generate-image.js — Vercel serverless handler for /api/generate-image
//
// Accepts POST { referenceImages }
//   referenceImages : array of { data: string, mimeType?: string } where
//                     data is either a base64 data URL or a raw base64 string.
//
// Flow:
//   1. Extract the first reference image from referenceImages.
//   2. Normalise it to a base64 data URL (data:<mime>;base64,<data>).
//   3. POST to https://api.replicate.com/v1/predictions using
//      model "stability-ai/sdxl" with the image and a fixed realistic-render
//      prompt.
//   4. Poll the returned URL until the prediction succeeds (max 60 s).
//   5. Return { imageUrl, revisedPrompt } as JSON.

'use strict';

const FINAL_PROMPT =
  'Turn this drawing into a realistic image. Keep the same design. Add realistic materials, lighting, and depth.';

const REPLICATE_ENDPOINT = 'https://api.replicate.com/v1/predictions';
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 60000;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const { referenceImages } = req.body || {};

    if (!Array.isArray(referenceImages) || referenceImages.length === 0) {
      return res.status(400).json({ error: { message: 'referenceImages array is required' } });
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: { message: 'REPLICATE_API_TOKEN is not configured' } });
    }

    // Extract the first reference image.
    const firstImage = referenceImages[0];
    let rawData;
    if (typeof firstImage === 'string') {
      rawData = firstImage;
    } else if (firstImage && typeof firstImage.data === 'string') {
      rawData = firstImage.data;
    } else {
      return res.status(400).json({ error: { message: 'Invalid reference image format' } });
    }

    // Ensure the image is a valid base64 data URL.
    let imageDataUrl;
    if (rawData.startsWith('data:')) {
      imageDataUrl = rawData;
    } else {
      const mimeType = (firstImage && typeof firstImage.mimeType === 'string')
        ? firstImage.mimeType
        : 'image/png';
      imageDataUrl = `data:${mimeType};base64,${rawData}`;
    }

    console.log('[REPLICATE] Starting image-to-image prediction');

    // Create the prediction.
    const createRes = await fetch(REPLICATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'stability-ai/sdxl',
        input: {
          prompt: FINAL_PROMPT,
          image: imageDataUrl,
          strength: 0.7
        }
      })
    });

    const createBodyText = await createRes.text();
    console.log('[REPLICATE] Create status:', createRes.status);

    if (!createRes.ok) {
      throw new Error(`Replicate API error ${createRes.status}: ${createBodyText}`);
    }

    let prediction;
    try {
      prediction = JSON.parse(createBodyText);
    } catch (e) {
      throw new Error(`Failed to parse Replicate response: ${createBodyText}`);
    }

    if (!prediction.urls || !prediction.urls.get) {
      throw new Error('Replicate did not return a polling URL: ' + JSON.stringify(prediction));
    }

    // Poll until the prediction completes (max TIMEOUT_MS).
    const pollUrl = prediction.urls.get;
    const deadline = Date.now() + TIMEOUT_MS;
    let result = prediction;

    while (
      result.status !== 'succeeded' &&
      result.status !== 'failed' &&
      result.status !== 'canceled'
    ) {
      if (Date.now() >= deadline) {
        throw new Error(`Replicate prediction timed out after ${TIMEOUT_MS / 1000} seconds`);
      }
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      const pollRes = await fetch(pollUrl, {
        headers: { 'Authorization': `Token ${process.env.REPLICATE_API_TOKEN}` }
      });
      if (!pollRes.ok) {
        throw new Error(`Replicate polling error ${pollRes.status}: ${await pollRes.text()}`);
      }
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

    console.log('[REPLICATE] Output URL:', imageUrl);

    return res.status(200).json({ imageUrl, revisedPrompt: FINAL_PROMPT });

  } catch (err) {
    console.error('api/generate-image error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
  }
};
