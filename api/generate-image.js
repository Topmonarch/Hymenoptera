// api/generate-image.js — Vercel serverless handler for /api/generate-image
//
// Accepts POST { referenceImages }
//   referenceImages : array of { data: string } where
//                     data is either a base64 data URL or a raw base64 string.
//
// Flow:
//   1. Extract the first reference image from referenceImages.
//   2. Normalise it to a base64 data URL (data:<mime>;base64,<data>).
//   3. Call OpenAI Images API (POST /v1/images/edits) with the image and a
//      fixed realistic-render prompt.
//   4. Return { imageUrl } as JSON.

'use strict';

const FINAL_PROMPT =
  'Convert this exact drawing into a highly realistic image. Preserve the exact shape, structure, and proportions. Do not change the design. Only enhance realism.';

const OPENAI_IMAGES_EDITS_URL = 'https://api.openai.com/v1/images/edits';

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

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: { message: 'OPENAI_API_KEY is not configured' } });
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
      imageDataUrl = `data:image/png;base64,${rawData}`;
    }

    // Extract mime type and base64 payload from data URL.
    const matches = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: { message: 'Invalid base64 image data URL' } });
    }
    const mimeType = matches[1];
    const base64Data = matches[2];
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Derive a sensible filename extension from the mime type.
    const ext = mimeType === 'image/jpeg' ? 'jpg'
      : mimeType === 'image/webp' ? 'webp'
      : mimeType === 'image/gif' ? 'gif'
      : 'png';
    const filename = `image.${ext}`;

    console.log('[OPENAI] Starting image edit');

    // Build multipart form data for OpenAI Images Edits API.
    const formData = new FormData();
    const imageBlob = new Blob([imageBuffer], { type: mimeType });
    formData.append('image', imageBlob, filename);
    formData.append('prompt', FINAL_PROMPT);
    formData.append('n', 1);
    formData.append('size', '1024x1024');

    const openaiRes = await fetch(OPENAI_IMAGES_EDITS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const openaiBodyText = await openaiRes.text();
    console.log('[OPENAI] Response status:', openaiRes.status);

    if (!openaiRes.ok) {
      throw new Error(`OpenAI API error ${openaiRes.status}: ${openaiBodyText}`);
    }

    let openaiData;
    try {
      openaiData = JSON.parse(openaiBodyText);
    } catch (e) {
      throw new Error(`Failed to parse OpenAI response: ${openaiBodyText}`);
    }

    const imageUrl = openaiData.data && openaiData.data[0] && openaiData.data[0].url;
    if (!imageUrl) {
      throw new Error('OpenAI returned no image URL: ' + JSON.stringify(openaiData));
    }

    console.log('[OPENAI] Image URL received');

    return res.status(200).json({ imageUrl });

  } catch (err) {
    console.error('api/generate-image error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
  }
};
