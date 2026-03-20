// lib/validate.js — Shared input validation helpers for Cloud Functions
'use strict';

// Max base64 payload sizes (base64 is ~33% larger than raw)
const LIMITS = {
  PDF_SINGLE_MB:  50,   // 50 MB per PDF file
  PDF_MERGE_TOTAL:200,  // 200 MB total across all merge inputs
  IMAGE_MB:       20,   // 20 MB per image
  PASSWORD_CHARS: 512,
};

/**
 * Reject if Content-Type is not application/json
 */
function requireJSON(req, res) {
  const ct = req.headers['content-type'] || '';
  if (!ct.includes('application/json')) {
    res.status(415).json({ error: 'Content-Type must be application/json' });
    return false;
  }
  return true;
}

/**
 * Check base64 string byte size
 * @param {string} b64
 * @param {number} maxMB
 * @returns {boolean} true if within limit
 */
function withinSizeMB(b64, maxMB) {
  if (typeof b64 !== 'string') return false;
  // Base64 length → raw bytes: length * 0.75
  const rawBytes = Math.ceil(b64.length * 0.75);
  return rawBytes <= maxMB * 1024 * 1024;
}

/**
 * Validate a single base64 PDF input.
 * Returns error message string if invalid, null if OK.
 * @param {*} b64
 * @param {number} [maxMB]
 */
function validatePDFBase64(b64, maxMB = LIMITS.PDF_SINGLE_MB) {
  if (!b64 || typeof b64 !== 'string') return '"file" must be a base64 string';
  if (!withinSizeMB(b64, maxMB)) return `File exceeds ${maxMB} MB limit`;
  return null;
}

/**
 * Validate an image base64 input.
 */
function validateImageBase64(b64, maxMB = LIMITS.IMAGE_MB) {
  if (!b64 || typeof b64 !== 'string') return '"file" must be a base64 string';
  if (!withinSizeMB(b64, maxMB)) return `Image exceeds ${maxMB} MB limit`;
  return null;
}

/**
 * Validate array of PDF base64 strings (for merge).
 */
function validatePDFArray(files, maxFiles = 20) {
  if (!Array.isArray(files))         return '"files" must be an array';
  if (files.length < 2)              return 'Provide at least 2 PDF files';
  if (files.length > maxFiles)       return `Maximum ${maxFiles} files per request`;

  let totalBytes = 0;
  for (let i = 0; i < files.length; i++) {
    if (typeof files[i] !== 'string') return `files[${i}] must be a base64 string`;
    totalBytes += Math.ceil(files[i].length * 0.75);
    if (totalBytes > LIMITS.PDF_MERGE_TOTAL * 1024 * 1024)
      return `Total input size exceeds ${LIMITS.PDF_MERGE_TOTAL} MB`;
  }
  return null;
}

module.exports = { requireJSON, validatePDFBase64, validateImageBase64, validatePDFArray, withinSizeMB, LIMITS };
