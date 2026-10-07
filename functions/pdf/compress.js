// pdf/compress.js — Cloud Function: POST /pdfCompress
// Reduces PDF size by removing redundant data and downsampling metadata.
// Note: PDF-lib doesn't do lossy image recompression; true compression needs ghostscript
// or a commercial API. This function does lossless optimization (object compaction).
'use strict';

const { PDFDocument } = require('pdf-lib');
const { requireJSON, validatePDFBase64 } = require('../lib/validate');

async function compressPDF(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireJSON(req, res)) return;

  const { file } = req.body;
  const fileErr = validatePDFBase64(file);
  if (fileErr) return res.status(400).json({ error: fileErr });

  const inputBytes = Buffer.from(file, 'base64');

  try {
    const doc          = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
    // Save with object streams enabled (compresses cross-reference table)
    const outputBytes  = await doc.save({ useObjectStreams: true, addDefaultPage: false });
    const result       = Buffer.from(outputBytes).toString('base64');
    const savedPercent = Math.round((1 - outputBytes.length / inputBytes.length) * 100);

    return res.status(200).json({
      pdf:          result,
      originalSize: inputBytes.length,
      compressedSize: outputBytes.length,
      savedPercent: Math.max(0, savedPercent),
      pages:        doc.getPageCount(),
    });
  } catch (e) {
    console.error('[pdfCompress]', e.message);
    return res.status(500).json({ error: 'PDF compression failed: ' + e.message });
  }
}

module.exports = { compressPDF };
