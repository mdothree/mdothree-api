// pdf/merge.js — Cloud Function: POST /pdfMerge
// Accepts multiple PDFs as base64 strings, merges them, returns merged base64 PDF.
'use strict';

const { PDFDocument } = require('pdf-lib');
const { requireJSON, validatePDFArray } = require('../../lib/validate');

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function mergePDF(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireJSON(req, res)) return;

  const { files } = req.body;
  const arrayErr = validatePDFArray(files);
  if (arrayErr) return res.status(400).json({ error: arrayErr }); // Array of base64-encoded PDF strings
  if (!Array.isArray(files) || files.length < 2) {
    return res.status(400).json({ error: 'Provide at least 2 PDF files as base64 in "files" array' });
  }
  if (files.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 files per merge request' });
  }

  try {
    const merged = await PDFDocument.create();

    for (const b64 of files) {
      const bytes = Buffer.from(b64, 'base64');
      const pdf   = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }

    const mergedBytes = await merged.save();
    const result      = Buffer.from(mergedBytes).toString('base64');

    return res.status(200).json({
      pdf:   result,
      pages: merged.getPageCount(),
      bytes: mergedBytes.length,
    });
  } catch (e) {
    console.error('[pdfMerge]', e.message);
    return res.status(500).json({ error: 'PDF merge failed: ' + e.message });
  }
}

module.exports = { mergePDF };
