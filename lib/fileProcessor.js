// lib/fileProcessor.js — Multimodal file processing helper
//
// Provides utilities for detecting file types, extracting text content, and
// preparing file data for OpenAI analysis.  All processing logic is isolated
// in this module so the upload endpoint stays thin.
//
// No external npm packages are used — only Node.js built-ins.

'use strict';

// Maximum characters extracted from text/code/PDF files before truncation.
// Keeps prompts within safe OpenAI token limits.
const MAX_TEXT_CHARS = 50000;

// Supported MIME types grouped by category.
const SUPPORTED_MIME_TYPES = {
  image: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml'
  ],
  pdf: [
    'application/pdf'
  ],
  text: [
    'text/plain',
    'text/markdown',
    'text/csv'
  ],
  code: [
    'text/javascript',
    'application/javascript',
    'text/html',
    'text/css',
    'text/x-python',
    'application/x-python',
    'text/x-c',
    'text/x-c++src',
    'text/x-java-source',
    'application/json',
    'text/x-typescript',
    'text/x-go',
    'text/x-rust',
    'text/xml',
    'application/xml',
    'text/x-sh',
    'application/x-sh'
  ],
  video: [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'video/ogg'
  ]
};

// File extension to category mapping used when MIME type is unavailable or
// generic (e.g. 'application/octet-stream').
const EXTENSION_CATEGORY = {
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image',
  '.gif': 'image', '.webp': 'image', '.svg': 'image',
  '.pdf': 'pdf',
  '.txt': 'text', '.md': 'text', '.csv': 'text', '.log': 'text',
  '.js': 'code', '.ts': 'code', '.jsx': 'code', '.tsx': 'code',
  '.py': 'code', '.html': 'code', '.htm': 'code', '.css': 'code',
  '.json': 'code', '.xml': 'code', '.yaml': 'code', '.yml': 'code',
  '.sh': 'code', '.bash': 'code', '.java': 'code', '.c': 'code',
  '.cpp': 'code', '.cc': 'code', '.h': 'code', '.go': 'code',
  '.rs': 'code', '.rb': 'code', '.php': 'code', '.sql': 'code',
  '.mp4': 'video', '.mov': 'video', '.avi': 'video',
  '.webm': 'video', '.mkv': 'video', '.ogv': 'video'
};

/**
 * Remove characters that could cause path traversal or injection issues.
 * Returns a safe ASCII-only file name, maximum 255 characters.
 *
 * @param {string} name - Raw file name supplied by the client
 * @returns {string}
 */
function sanitizeFileName(name) {
  if (typeof name !== 'string') return 'upload';
  // Strip path separators and non-printable / non-ASCII characters.
  return name
    .replace(/[/\\]/g, '')          // no path separators
    .replace(/\.\./g, '')            // no parent directory traversal
    .replace(/[^\w.\-\s]/g, '')      // only word chars, dots, dashes, spaces
    .trim()
    .slice(0, 255) || 'upload';
}

/**
 * Determine the semantic category of a file from its MIME type and/or name.
 *
 * @param {string} fileName - Original file name (used for extension fallback)
 * @param {string} mimeType - MIME type reported by the client
 * @returns {'image'|'pdf'|'text'|'code'|'video'|null}
 *   null when the file type is not supported
 */
function detectFileType(fileName, mimeType) {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();

  // Check MIME type first for accuracy.
  for (const [category, types] of Object.entries(SUPPORTED_MIME_TYPES)) {
    if (types.includes(mime)) return category;
  }

  // Fall back to file extension when the MIME type is absent or generic.
  const ext = ((fileName || '').toLowerCase().match(/(\.[^.]+)$/) || [])[1] || '';
  return EXTENSION_CATEGORY[ext] || null;
}

/**
 * Decode base64 file data and return the content as a UTF-8 string.
 * Truncates to MAX_TEXT_CHARS to keep prompts within token limits.
 *
 * Suitable for plain text, Markdown, CSV, and all code file categories.
 *
 * @param {string} base64Data - Base64-encoded file bytes
 * @param {string} [fileName] - File name (used only for logging)
 * @returns {string} Extracted text content
 */
function extractText(base64Data, fileName) {
  if (typeof base64Data !== 'string' || !base64Data) return '';
  try {
    const buffer = Buffer.from(base64Data, 'base64');
    const text = buffer.toString('utf-8');
    if (text.length > MAX_TEXT_CHARS) {
      return text.slice(0, MAX_TEXT_CHARS) +
        `\n\n[Content truncated — showing first ${MAX_TEXT_CHARS} characters]`;
    }
    return text;
  } catch (e) {
    return '';
  }
}

/**
 * Build an OpenAI vision content object for an image file.
 * The returned object is ready to be placed in the `content` array of a
 * chat-completions message.
 *
 * @param {string} base64Data - Base64-encoded image bytes
 * @param {string} mimeType   - Image MIME type (e.g. 'image/png')
 * @returns {{ type: 'image_url', image_url: { url: string, detail: string } }}
 */
function prepareImageForVision(base64Data, mimeType) {
  const safeMime = (mimeType || 'image/jpeg').toLowerCase().split(';')[0].trim();
  return {
    type: 'image_url',
    image_url: {
      url: `data:${safeMime};base64,${base64Data}`,
      detail: 'auto'
    }
  };
}

/**
 * Produce a plain-text description of video metadata to include in the AI
 * prompt.  Full video decoding is not performed — this is a best-effort
 * description based on the information available at upload time.
 *
 * @param {string} fileName - Sanitized file name
 * @param {number} fileSize - File size in bytes
 * @param {string} mimeType - Video MIME type (e.g. 'video/mp4')
 * @returns {string} Human-readable metadata summary
 */
function prepareVideoMetadata(fileName, fileSize, mimeType) {
  const safe = sanitizeFileName(fileName);
  const sizeKB = Math.round((fileSize || 0) / 1024);
  const sizeMB = (sizeKB / 1024).toFixed(2);
  return (
    `Video file uploaded:\n` +
    `  Name: ${safe}\n` +
    `  Size: ${sizeKB >= 1024 ? sizeMB + ' MB' : sizeKB + ' KB'}\n` +
    `  Type: ${mimeType || 'unknown'}`
  );
}

module.exports = {
  detectFileType,
  extractText,
  prepareImageForVision,
  prepareVideoMetadata,
  sanitizeFileName,
  SUPPORTED_MIME_TYPES,
  EXTENSION_CATEGORY
};
