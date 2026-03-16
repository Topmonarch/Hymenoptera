// api/generate-image.js — Vercel serverless handler for /api/generate-image
//
// Accepts POST { prompt, userId, plan, sessionId, size, quality,
//                referenceImages, strictReferenceMode, referenceFidelity }
//   prompt             : text description / scene instructions (string, required)
//   userId             : authenticated user ID or 'guest' (string, optional)
//   plan               : subscription plan name (string, optional)
//   sessionId          : anonymous session ID (string, optional)
//   size               : image size — '1024x1024' | '1792x1024' | '1024x1792' (optional)
//   quality            : 'standard' | 'hd' (string, optional)
//   referenceImages    : array of { data: string, mimeType: string } — uploaded reference
//                        images to follow when generating (optional)
//   strictReferenceMode: boolean — legacy flag; when true (or auto-detected from the
//                        prompt) activates high-fidelity reference mode (optional)
//   referenceFidelity  : 'balanced' | 'high' | 'exact' — controls how closely the
//                        generated image follows the reference.  When omitted the value
//                        is derived from strictReferenceMode / prompt auto-detection.
//                        'balanced' — standard generation even when a reference is
//                          present (no strict prompt reinforcement).
//                        'high'    — reference is used as the design blueprint; the
//                          fidelity-reinforced prompt is applied (default when a
//                          reference image is uploaded).
//                        'exact'   — maximum reference preservation; creativity is
//                          further suppressed and additional constraints are injected.
//
// The endpoint:
//   1. Validates the request fields.
//   2. Checks the daily image generation quota via usageLimits.
//   3. When referenceFidelity is 'high' or 'exact' and reference images are provided,
//      uses GPT-4o Vision to produce a structured design analysis of the reference,
//      then builds a fidelity-reinforced prompt before calling DALL-E 3.
//   4. Calls OpenAI DALL-E 3 to generate the image.
//   5. Returns { imageUrl: "<url>", revisedPrompt: "<text>" } as JSON.
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

// Allowed reference fidelity levels.
// 'balanced' — standard generation (no strict prompt reinforcement)
// 'high'     — reference is the design blueprint (fidelity-reinforced prompt)
// 'exact'    — maximum preservation; creativity suppressed, extra constraints added
const ALLOWED_FIDELITY = ['balanced', 'high', 'exact'];

// Maximum characters accepted by the DALL-E 3 prompt field.
const DALLE3_MAX_PROMPT_LENGTH = 4000;

// Pattern for validating data URLs containing base64-encoded images.
// Used in multiple places; defined once here to ensure consistency.
const DATA_URL_PATTERN = /^data:image\/[a-z0-9.+-]+;base64,/i;

// Regex patterns that indicate a strict fidelity request in the user's prompt.
// When any of these match, strictReferenceMode is automatically enabled.
const STRICT_FIDELITY_PATTERNS = [
  /\bexact(ly)?\b/i,
  /\bdo\s*not\s*change\b/i,
  /\bdon'?t\s*change\b/i,
  /\bpreserve\s*this\b/i,
  /\bsame\s*design\b/i,
  /\bmake\s*this\s*realistic\b/i,
  /\buse\s*this\s*exact\b/i,
  /\bkeep\s*the\s*design\b/i,
  /\bput\s*this\s*on\b/i,
  /\bmake\s*this\s*real\b/i,
  /\bturn\s*this\s+(?:drawing|sketch|design|image)\b/i,
  /\bno\s*changes?\b/i,
  /\bfaithful(ly)?\b/i,
  /\bfidelity\b/i,
  /\baccurate(ly)?\b/i,
];

/**
 * Returns true when the prompt text contains language that strongly requests
 * high-fidelity reproduction of a reference image.
 *
 * @param {string} prompt
 * @returns {boolean}
 */
function detectStrictFidelityMode(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  return STRICT_FIDELITY_PATTERNS.some(function (re) { return re.test(prompt); });
}

/**
 * Calls GPT-4o Vision to produce a structured design analysis of the first
 * (primary blueprint) reference image.  The analysis is used to build a
 * fidelity-reinforced DALL-E 3 prompt.
 *
 * @param {string} apiKey          OpenAI API key
 * @param {{ data: string, mimeType: string }[]} referenceImages
 * @returns {Promise<string>}      Structured text description, or '' on failure
 */
async function analyzeReferenceImage(apiKey, referenceImages) {
  if (!referenceImages || referenceImages.length === 0) return '';

  // Build image_url parts for the analysis request.
  // Primary blueprint = first image; additional images included as supporting refs.
  const imageParts = referenceImages.slice(0, 4).map(function (img) {
    const mimeType = (img.mimeType || 'image/jpeg').split(';')[0].trim();
    const url = img.data.startsWith('data:') ? img.data : ('data:' + mimeType + ';base64,' + img.data);
    return { type: 'image_url', image_url: { url: url, detail: 'high' } };
  }).filter(function (part) {
    return DATA_URL_PATTERN.test(part.image_url.url) || /^data:image\//.test(part.image_url.url);
  });

  if (imageParts.length === 0) return '';

  const analysisMessages = [
    {
      role: 'system',
      content:
        'You are a precise visual design analyst. Examine the provided reference image(s) and produce a ' +
        'structured design description that will be used to guide a faithful image recreation. ' +
        'Be concise but comprehensive. Focus only on visual/design attributes — no commentary.'
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'Analyze this reference image and describe its visual design in structured detail. ' +
            'Cover these attributes where applicable:\n' +
            '- Object or garment category\n' +
            '- Overall silhouette and outline shape\n' +
            '- Proportions and key dimensions\n' +
            '- Major color zones and color blocking\n' +
            '- Stripe, marking, or pattern layout\n' +
            '- Material or texture cues\n' +
            '- Seams, panels, and structural elements\n' +
            '- Edge shapes and profile\n' +
            '- Openings or cutouts\n' +
            '- Placement of distinctive features\n' +
            '- Front/side/profile cues visible\n\n' +
            'Output a concise structured description only. No preamble.'
        },
        ...imageParts
      ]
    }
  ];

  try {
    const visionRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: analysisMessages,
        max_tokens: 600,
        temperature: 0.2
      })
    });
    if (!visionRes.ok) return '';
    const visionData = await visionRes.json();
    const content =
      visionData.choices &&
      visionData.choices[0] &&
      visionData.choices[0].message &&
      visionData.choices[0].message.content;
    return (typeof content === 'string' ? content.trim() : '');
  } catch (e) {
    console.warn('api/generate-image: reference image analysis failed:', e.message);
    return '';
  }
}

/**
 * Builds a fidelity-reinforced DALL-E 3 prompt that instructs the model to
 * treat the reference design as the authoritative blueprint while using the
 * user's text only for scene / context / environment.
 *
 * @param {string} userPrompt       Original text from the user
 * @param {string} designAnalysis   Structured design description from GPT-4o
 * @param {boolean} hasMultipleRefs Whether secondary reference images were provided
 * @param {string} [fidelityLevel]  'high' (default) or 'exact' for maximum preservation
 * @returns {string}
 */
function buildStrictReferencePrompt(userPrompt, designAnalysis, hasMultipleRefs, fidelityLevel) {
  const blueprintSection = designAnalysis
    ? 'DESIGN BLUEPRINT (from uploaded reference image):\n' + designAnalysis
    : 'DESIGN BLUEPRINT: Follow the uploaded reference image exactly as the design source.';

  const secondaryNote = hasMultipleRefs
    ? '\nSecondary reference image(s) may provide material, realism, or lighting guidance but must NOT override the primary blueprint design.'
    : '';

  const isExact = fidelityLevel === 'exact';

  const header = isExact
    ? '[EXACT REFERENCE FIDELITY — MAXIMUM PRESERVATION — DO NOT DEVIATE]\n\n'
    : '[STRICT REFERENCE FIDELITY — PRESERVE DESIGN EXACTLY]\n\n';

  const extraExactConstraints = isExact
    ? '- EXACT mode: minimize all creativity — only add realism, materials, shading, and depth.\n' +
      '- EXACT mode: preserve every visual detail visible in the reference.\n' +
      '- EXACT mode: treat even minor features as mandatory — do not simplify or omit them.\n' +
      '- EXACT mode: do not add style interpretation; convert to the requested render level only.\n'
    : '';

  return (
    header +
    blueprintSection +
    secondaryNote +
    '\n\nSCENE / CONTEXT INSTRUCTION (from user):\n' + userPrompt +
    '\n\nCRITICAL GENERATION RULES — DO NOT DEVIATE:\n' +
    '- The uploaded reference image IS the design blueprint. Reproduce it faithfully.\n' +
    '- Preserve the exact overall silhouette and outer contour.\n' +
    '- Maintain all proportions and major geometry precisely.\n' +
    '- Keep every color zone, color block, and color layout exactly as in the reference.\n' +
    '- Preserve all stripes, markings, and pattern layouts without alteration.\n' +
    '- Maintain panel placement, visible seams, and structural elements.\n' +
    '- Keep the shape of any openings, cutouts, and edge profiles intact.\n' +
    '- Preserve placement of all distinctive features.\n' +
    '- Only change what the scene instruction explicitly requests: pose, subject, environment, lighting, background, realism level.\n' +
    '- DO NOT redesign, reinvent, or creatively alter the uploaded design.\n' +
    '- DO NOT randomly shift colors, add extra features, or change the silhouette.\n' +
    '- DO NOT treat the reference as loose inspiration — reproduce it exactly.\n' +
    '- Bias strongly toward fidelity over creativity.\n' +
    extraExactConstraints +
    '\nNEGATIVE CONSTRAINTS: do not redesign; do not alter silhouette; do not change proportions; ' +
    'do not add ornaments; do not change layout; do not invent extra features; do not replace the original design language.'
  );
}

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
      strictReferenceMode,
      referenceFidelity
    } = req.body || {};

    // ── Input validation ────────────────────────────────────────────────────

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: { message: 'prompt (string) is required' } });
    }

    // Sanitize prompt: trim whitespace and limit length to avoid abuse.
    const safePrompt = prompt.trim().slice(0, DALLE3_MAX_PROMPT_LENGTH);

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

    // ── Strict reference mode resolution ───────────────────────────────────
    // Normalise the reference images list (mirrors the pattern used in api/chat.js).
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
    const hasReferenceImages = refImageList.length > 0;

    // Resolve the effective fidelity level.
    //   1. Use the explicit referenceFidelity parameter when it is a valid value.
    //   2. Fall back to the legacy strictReferenceMode boolean or prompt auto-detection
    //      and map those to 'high'.
    //   3. When a reference image is present but no explicit fidelity was given and
    //      strictReferenceMode was not explicitly set to false, default to 'high'.
    //   4. Otherwise keep 'balanced' (standard generation).
    let effectiveFidelity = 'balanced';
    if (ALLOWED_FIDELITY.includes(referenceFidelity)) {
      effectiveFidelity = referenceFidelity;
    } else if (hasReferenceImages && (strictReferenceMode === true || detectStrictFidelityMode(safePrompt))) {
      effectiveFidelity = 'high';
    } else if (hasReferenceImages && strictReferenceMode !== false) {
      // A reference image was uploaded but no explicit fidelity level or legacy flag
      // was given — default to 'high' so the reference is used as the design blueprint.
      // Callers that explicitly pass strictReferenceMode: false opt out of this default.
      effectiveFidelity = 'high';
    }

    const isStrictMode = hasReferenceImages && effectiveFidelity !== 'balanced';

    if (isStrictMode) {
      console.log(
        'api/generate-image: strict reference fidelity mode ACTIVE (' + effectiveFidelity + ') — ' +
        refImageList.length + ' reference image(s), prompt snippet: "' +
        safePrompt.slice(0, 80) + '"'
      );
    }

    // ── OpenAI DALL-E 3 API call ────────────────────────────────────────────

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    // When strict mode is active, analyse the reference image with GPT-4o
    // Vision to derive a structured design description, then build a
    // fidelity-reinforced prompt for DALL-E 3.
    let finalPrompt = safePrompt;
    if (isStrictMode) {
      const designAnalysis = await analyzeReferenceImage(apiKey, refImageList);
      finalPrompt = buildStrictReferencePrompt(
        safePrompt,
        designAnalysis,
        refImageList.length > 1,
        effectiveFidelity
      );
      // DALL-E 3 prompt character limit.
      finalPrompt = finalPrompt.slice(0, DALLE3_MAX_PROMPT_LENGTH);
    }

    const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: finalPrompt,
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
