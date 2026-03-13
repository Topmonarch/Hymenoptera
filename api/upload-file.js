// api/upload-file.js — Vercel serverless handler for /api/upload-file
//
// Accepts POST { fileData, fileName, mimeType, fileSize, userId, plan, sessionId }
//   fileData  : base64-encoded file bytes (string)
//   fileName  : original file name (string)
//   mimeType  : MIME type reported by the browser (string)
//   fileSize  : file size in bytes (number)
//   userId    : authenticated user ID or 'guest' (string, optional)
//   plan      : subscription plan name (string, optional)
//   sessionId : anonymous session ID (string, optional)
//
// The endpoint:
//   1. Validates the request fields and enforces file-size limits.
//   2. Checks the daily upload quota via usageLimits.
//   3. Delegates file processing to lib/fileProcessor.
//   4. Calls OpenAI to analyze the file content.
//   5. Returns { analysis: "<AI response text>" } as JSON.
//
// The existing /api/chat endpoint is NOT modified.

'use strict';

// File processing helper — isolated module, never modifies existing systems.
const fileProcessor = require('../lib/fileProcessor');

// Usage limits helper — loaded lazily so a missing / misconfigured module
// never blocks the upload flow.
let _usageLimits = null;
try {
  _usageLimits = require('../lib/usageLimits');
} catch (e) {
  console.warn('api/upload-file: usage limits unavailable:', e.message);
}

// Maximum accepted file sizes (bytes).
const MAX_FILE_SIZE_BYTES = {
  image: 10 * 1024 * 1024,  // 10 MB
  pdf:   20 * 1024 * 1024,  // 20 MB
  text:  5  * 1024 * 1024,  // 5 MB
  code:  5  * 1024 * 1024,  // 5 MB
  video: 50 * 1024 * 1024   // 50 MB
};

const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB for unknown types

/**
 * Build the OpenAI messages array for a given file category and its processed
 * content.  Returns an array of message objects ready to send to the Chat
 * Completions API.
 *
 * @param {'image'|'pdf'|'text'|'code'|'video'} category
 * @param {string} fileName   - Sanitized file name
 * @param {string} base64Data - Base64-encoded file bytes
 * @param {string} mimeType   - MIME type
 * @param {number} fileSize   - File size in bytes
 * @returns {Array<Object>}   Array of {role, content} messages
 */
function buildAnalysisMessages(category, fileName, base64Data, mimeType, fileSize) {
  if (category === 'image') {
    const visionContent = fileProcessor.prepareImageForVision(base64Data, mimeType);
    return [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant. The user has uploaded an image. ' +
          'Describe what you see in detail, including objects, text, colors, and any notable features.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Please analyze this image (${fileName}) and describe what you see.`
          },
          visionContent
        ]
      }
    ];
  }

  if (category === 'pdf') {
    // GPT-4o supports PDF base64 data in Chat Completions via the file content type.
    return [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant. The user has uploaded a PDF document. ' +
          'Summarize its contents, highlight key points, and answer questions about it.'
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Please analyze and summarize the contents of this PDF document: ${fileName}`
          },
          {
            type: 'file',
            file: {
              filename: fileName,
              file_data: `data:application/pdf;base64,${base64Data}`
            }
          }
        ]
      }
    ];
  }

  if (category === 'text' || category === 'code') {
    const extractedText = fileProcessor.extractText(base64Data, fileName);
    const label = category === 'code' ? 'code file' : 'text document';
    const instruction =
      category === 'code'
        ? 'Analyze the code, explain what it does, identify the programming language, and note any potential improvements or issues.'
        : 'Summarize the document, identify the main topics, and highlight key information.';
    return [
      {
        role: 'system',
        content: `You are a helpful AI assistant. The user has uploaded a ${label}. ${instruction}`
      },
      {
        role: 'user',
        content:
          `Please analyze this ${label} (${fileName}):\n\n` +
          '```\n' + extractedText + '\n```'
      }
    ];
  }

  if (category === 'video') {
    const metadata = fileProcessor.prepareVideoMetadata(fileName, fileSize, mimeType);
    return [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant. The user has uploaded a video file. ' +
          'Based on the available metadata, provide useful information about the video.'
      },
      {
        role: 'user',
        content:
          'I have uploaded a video file. Here is the metadata:\n\n' +
          metadata +
          '\n\nBased on this information, what can you tell me about this video? ' +
          'What might I be able to do with it or ask about it?'
      }
    ];
  }

  // Fallback — should not be reached after validation.
  return [
    { role: 'system', content: 'You are a helpful AI assistant.' },
    { role: 'user', content: `A file named "${fileName}" was uploaded but its type could not be determined.` }
  ];
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: { message: 'Method not allowed' } });
  }

  try {
    const {
      fileData,
      fileName,
      mimeType,
      fileSize,
      userId,
      plan,
      sessionId
    } = req.body || {};

    // ── Input validation ────────────────────────────────────────────────────

    if (!fileData || typeof fileData !== 'string') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: { message: 'fileData (base64 string) is required' } });
    }

    if (!fileName || typeof fileName !== 'string') {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: { message: 'fileName is required' } });
    }

    const safeName = fileProcessor.sanitizeFileName(fileName);

    // Detect file category from MIME type + extension.
    const category = fileProcessor.detectFileType(safeName, mimeType);
    if (!category) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(415).json({
        error: {
          message:
            'Unsupported file type. Allowed types: images (jpg, png, gif, webp), ' +
            'PDF documents, text files, code files, and videos (mp4, mov, webm, avi).'
        }
      });
    }

    // Enforce per-category file size limits.
    const resolvedFileSize = Number(fileSize) || 0;
    const maxBytes = MAX_FILE_SIZE_BYTES[category] || DEFAULT_MAX_FILE_SIZE_BYTES;
    if (resolvedFileSize > maxBytes) {
      const maxMB = Math.round(maxBytes / (1024 * 1024));
      res.setHeader('Content-Type', 'application/json');
      return res.status(413).json({
        error: { message: `File too large. Maximum size for ${category} files is ${maxMB} MB.` }
      });
    }

    // Also validate the actual base64 payload size as a secondary guard.
    // Base64 encoding inflates size by ~33 %, so multiply the limit accordingly.
    const base64MaxBytes = Math.ceil(maxBytes * 1.4);
    if (fileData.length > base64MaxBytes) {
      const maxMB = Math.round(maxBytes / (1024 * 1024));
      res.setHeader('Content-Type', 'application/json');
      return res.status(413).json({
        error: { message: `File too large. Maximum size for ${category} files is ${maxMB} MB.` }
      });
    }

    // ── Daily upload quota ──────────────────────────────────────────────────

    if (_usageLimits) {
      const trackingId = (userId && userId !== 'guest') ? userId : sessionId;
      if (trackingId) {
        try {
          const KNOWN_PLANS = Object.keys(_usageLimits.PLAN_LIMITS);
          const rawPlan = typeof plan === 'string' ? plan.toLowerCase() : '';
          const userPlan = KNOWN_PLANS.includes(rawPlan) ? rawPlan : 'starter';
          const result = await _usageLimits.checkAndTrack(trackingId, userPlan, 'upload');
          if (!result.allowed) {
            res.setHeader('Content-Type', 'application/json');
            return res.status(429).json({
              error: { message: result.error || 'Daily upload limit reached. Upgrade your plan or wait for the reset.' }
            });
          }
        } catch (e) {
          // Upload limit check failure is non-fatal — let the request proceed.
          console.warn('api/upload-file: usage limit check failed:', e.message);
        }
      }
    }

    // ── OpenAI API call ─────────────────────────────────────────────────────

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: 'API key not configured' } });
    }

    const apiMessages = buildAnalysisMessages(
      category,
      safeName,
      fileData,
      mimeType || '',
      resolvedFileSize
    );

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: apiMessages,
        stream: false
      })
    });

    if (!openaiRes.ok) {
      let errData;
      try { errData = await openaiRes.json(); } catch (e) { errData = null; }
      res.setHeader('Content-Type', 'application/json');
      return res.status(502).json({
        error: (errData && errData.error) || { message: 'Upstream AI service error' }
      });
    }

    const openaiData = await openaiRes.json();
    const analysis =
      (openaiData.choices &&
        openaiData.choices[0] &&
        openaiData.choices[0].message &&
        openaiData.choices[0].message.content) ||
      'The AI could not analyze this file.';

    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json({ analysis, category, fileName: safeName });
  } catch (err) {
    console.error('api/upload-file error:', err);
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: { message: err.message || 'Internal server error' } });
    }
  }
};
