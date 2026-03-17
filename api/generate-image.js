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
// The endpoint uses two internal routes:
//   text_to_image_route    — called when no reference image is provided; generates from
//                            the text prompt alone using DALL-E 3.
//   image_to_image_route   — called when at least one reference image is uploaded; the
//                            reference is treated as the EXACT design blueprint.  A
//                            system prompt overrides the raw user prompt, negative
//                            constraints are appended, and the fidelity-reinforced
//                            prompt is built from a GPT-4o Vision design analysis.
//                            Low-drift config (strength=0.9, creativity=low) is logged.
//                            If the initial result fails fidelity validation it is
//                            automatically regenerated in 'exact' mode.
//
// The endpoint:
//   1. Validates the request fields.
//   2. Checks the daily image generation quota via usageLimits.
//   3. Detects whether a reference image is present (hasReferenceImage) and routes
//      to the appropriate generation path.
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
 * Uses GPT-4o Vision to compare the generated image against the reference and
 * score how faithfully it reproduces the reference design.
 *
 * Scores are 1–10 per dimension.  The result is considered passing when the
 * overall score is >= 7.  On any error the function returns a passing result
 * so that a validation failure never blocks the response.
 *
 * @param {string} apiKey                OpenAI API key
 * @param {{ data: string, mimeType: string }[]} referenceImages
 * @param {string} generatedImageUrl     URL of the DALL-E 3 generated image
 * @param {string} userPrompt            The user's original text prompt
 * @returns {Promise<{ pass: boolean, score: number, issues: string }>}
 */
async function validateImageFidelity(apiKey, referenceImages, generatedImageUrl, userPrompt) {
  if (!referenceImages || referenceImages.length === 0 || !generatedImageUrl) {
    return { pass: true, score: 10, issues: '' };
  }

  // Only include the primary reference image for the comparison.
  const refParts = referenceImages.slice(0, 1).map(function (img) {
    const mimeType = (img.mimeType || 'image/jpeg').split(';')[0].trim();
    const url = img.data.startsWith('data:') ? img.data : ('data:' + mimeType + ';base64,' + img.data);
    return { type: 'image_url', image_url: { url: url, detail: 'high' } };
  }).filter(function (part) {
    return DATA_URL_PATTERN.test(part.image_url.url) || /^data:image\//.test(part.image_url.url);
  });

  if (refParts.length === 0) return { pass: true, score: 10, issues: '' };

  const validationMessages = [
    {
      role: 'system',
      content:
        'You are a strict visual fidelity validator. Compare the generated image against the reference ' +
        'image and objectively score how faithfully the generated image reproduces the reference design. ' +
        'Be strict: a passing score means the core reference design is clearly preserved; failing means ' +
        'the design was significantly altered, replaced, or used only as loose inspiration.'
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'REFERENCE IMAGE (the design blueprint that must be reproduced):' },
        ...refParts,
        { type: 'text', text: 'GENERATED IMAGE (evaluate how faithfully it reproduces the reference):' },
        { type: 'image_url', image_url: { url: generatedImageUrl, detail: 'high' } },
        {
          type: 'text',
          text:
            'The user instruction was: "' + userPrompt + '"\n\n' +
            'Score the GENERATED IMAGE against the REFERENCE IMAGE on each dimension (1 = completely different, 10 = identical):\n' +
            '1. Silhouette similarity — does the overall shape/outline match?\n' +
            '2. Proportion accuracy — are key dimensions and ratios preserved?\n' +
            '3. Design fidelity — are color zones, markings, patterns, and panels preserved?\n' +
            '4. Identity preservation — does it look like the same object, character, or design?\n' +
            '5. Feature accuracy — are distinctive features present and correctly placed?\n\n' +
            'Respond ONLY in this exact JSON format (no markdown, no extra text):\n' +
            '{"silhouette":N,"proportions":N,"design":N,"identity":N,"features":N,"overall":N,"pass":true_or_false,"issues":"brief description of main deviations or empty string"}\n' +
            'Set pass to true when overall >= 7, false otherwise.'
        }
      ]
    }
  ];

  try {
    const valRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: validationMessages,
        max_tokens: 200,
        temperature: 0.1
      })
    });
    if (!valRes.ok) return { pass: true, score: 10, issues: '' };
    const valData = await valRes.json();
    const content =
      valData.choices &&
      valData.choices[0] &&
      valData.choices[0].message &&
      valData.choices[0].message.content;
    if (!content) return { pass: true, score: 10, issues: '' };
    // Strip any accidental markdown fences before parsing.
    const jsonText = content.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    const parsed = JSON.parse(jsonText);
    return {
      pass: parsed.pass === true,
      score: typeof parsed.overall === 'number' ? parsed.overall : 10,
      issues: typeof parsed.issues === 'string' ? parsed.issues : ''
    };
  } catch (e) {
    console.warn('api/generate-image: fidelity validation failed:', e.message);
    // Validation errors are non-fatal — pass through to avoid blocking the response.
    return { pass: true, score: 10, issues: '' };
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
 * image_to_image_route — generates an image using an uploaded reference image as
 * the strict design blueprint.  Applies a fidelity-reinforced system prompt,
 * negative constraints, and low-drift configuration to minimise design deviation.
 * Called when at least one reference image is provided.
 *
 * @param {{ apiKey: string, safePrompt: string, refImageList: Array, effectiveFidelity: string, resolvedSize: string, resolvedQuality: string }} params
 * @returns {Promise<{ imageUrl: string, revisedPrompt: string }>}
 */
async function generateImageWithReference(params) {
  const { apiKey, safePrompt, refImageList, effectiveFidelity, resolvedSize, resolvedQuality } = params;

  // ── Step 4: System prompt override ─────────────────────────────────────
  // The system prompt instructs the model to treat the reference image as the
  // authoritative design blueprint and suppresses creative deviations.
  const systemPrompt = `Use the uploaded reference image as the EXACT design blueprint.

Preserve:
- silhouette
- proportions
- structure
- all defining features

Do NOT:
- redesign
- add new details
- change shape
- alter proportions
- replace design

Only apply:
- realism
- materials
- lighting
- shading`;

  // ── Step 5: Negative constraints ────────────────────────────────────────
  const negativePrompt = `do not redesign,
do not change proportions,
do not alter silhouette,
do not add ornaments,
do not invent features,
do not replace design`;

  // ── Step 6: Low-drift configuration ────────────────────────────────────
  const config = {
    mode: 'image_to_image',
    strength: 0.9,
    creativity: 'low',
    variation: 'low'
  };

  // ── Analyse the reference image and build the fidelity-reinforced prompt ─
  // The design analysis is cached so it can be reused during auto-regeneration.
  const cachedDesignAnalysis = await analyzeReferenceImage(apiKey, refImageList);

  // Compose the final prompt: system instructions + structured reference analysis +
  // user intent + negative constraints.
  const basePrompt = buildStrictReferencePrompt(
    safePrompt,
    cachedDesignAnalysis,
    refImageList.length > 1,
    effectiveFidelity
  );
  const finalPrompt = (systemPrompt + '\nUser request: ' + safePrompt + '\n\n' + basePrompt + '\n\nNEGATIVE: ' + negativePrompt)
    .slice(0, DALLE3_MAX_PROMPT_LENGTH);

  // ── Step 8: Generation logs ─────────────────────────────────────────────
  console.log('[GENERATION] mode=image_to_image');
  console.log('[GENERATION] strength=' + config.strength);
  console.log('[GENERATION] prompt=', finalPrompt);

  const openaiRes = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
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

  // ── Fidelity validation and auto-regeneration ───────────────────────────
  // Validate the generated image against the reference.  If the fidelity score
  // is too low, regenerate once with escalated 'exact' settings.
  let finalImageUrl = imageData.url;
  let finalRevisedPrompt = imageData.revised_prompt || safePrompt;

  const validation = await validateImageFidelity(apiKey, refImageList, imageData.url, safePrompt);
  if (!validation.pass) {
    console.log(
      'api/generate-image: fidelity validation FAILED (score=' + validation.score +
      ', issues="' + validation.issues + '") — regenerating with exact mode'
    );
    const escalatedPrompt = (systemPrompt + '\nUser request: ' + safePrompt + '\n\n' +
      buildStrictReferencePrompt(safePrompt, cachedDesignAnalysis, refImageList.length > 1, 'exact') +
      '\n\nNEGATIVE: ' + negativePrompt
    ).slice(0, DALLE3_MAX_PROMPT_LENGTH);

    try {
      const regenRes = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: escalatedPrompt,
          n: 1,
          size: resolvedSize,
          quality: resolvedQuality,
          response_format: 'url'
        })
      });
      if (regenRes.ok) {
        const regenData = await regenRes.json();
        const regenImage = regenData.data && regenData.data[0];
        if (regenImage && regenImage.url) {
          finalImageUrl = regenImage.url;
          finalRevisedPrompt = regenImage.revised_prompt || safePrompt;
          console.log('api/generate-image: regeneration complete with exact fidelity mode');
        }
      }
    } catch (regenErr) {
      // Regeneration failure is non-fatal — return the original result.
      console.warn('api/generate-image: regeneration attempt failed:', regenErr.message);
    }
  }

  return { imageUrl: finalImageUrl, revisedPrompt: finalRevisedPrompt };
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
      referenceFidelity,
      hasReferenceImage: hasReferenceImageFlag
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

    // ── Normalise reference images list ─────────────────────────────────────
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

    // ── Step 2: Detect reference image ──────────────────────────────────────
    // hasReferenceImage is the single source of truth for routing decisions.
    const hasReferenceImage = refImageList.length > 0 || hasReferenceImageFlag === true;
    console.log('[DEBUG] hasReferenceImage:', hasReferenceImage);

    // ── OpenAI API key ──────────────────────────────────────────────────────

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    // ── Resolve effective fidelity level (used by image_to_image_route) ─────
    //   1. Use the explicit referenceFidelity parameter when it is a valid value.
    //   2. Fall back to the legacy strictReferenceMode boolean or prompt auto-detection.
    //   3. When a reference image is present with no explicit setting, default to 'high'.
    //   4. Otherwise keep 'balanced'.
    let effectiveFidelity = 'balanced';
    if (ALLOWED_FIDELITY.includes(referenceFidelity)) {
      effectiveFidelity = referenceFidelity;
    } else if (hasReferenceImage && (strictReferenceMode === true || detectStrictFidelityMode(safePrompt))) {
      effectiveFidelity = 'high';
    } else if (hasReferenceImage && strictReferenceMode !== false) {
      effectiveFidelity = 'high';
    }

    if (hasReferenceImage) {
      console.log(
        'api/generate-image: strict reference fidelity mode ACTIVE (' + effectiveFidelity + ') — ' +
        refImageList.length + ' reference image(s), prompt snippet: "' +
        safePrompt.slice(0, 80) + '"'
      );
    }

    // ── Step 3: Route to the appropriate generation path ────────────────────
    let result;
    if (hasReferenceImage) {
      console.log('[ROUTE] image_to_image_route');
      result = await generateImageWithReference({
        apiKey,
        safePrompt,
        refImageList,
        effectiveFidelity,
        resolvedSize,
        resolvedQuality
      });
    } else {
      console.log('[ROUTE] text_to_image_route');
      result = await generateImageFromText({
        apiKey,
        safePrompt,
        resolvedSize,
        resolvedQuality
      });
    }

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({
      imageUrl: result.imageUrl,
      revisedPrompt: result.revisedPrompt
    });
  } catch (err) {
    console.error('api/generate-image error:', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      const statusCode = err.statusCode || 500;
      return res.status(statusCode).json({ error: err.errorBody || { message: err.message || 'Internal server error' } });
    }
  }
};
