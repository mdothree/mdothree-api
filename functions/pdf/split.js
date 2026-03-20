// pdf/split.js — Cloud Function: POST /pdfSplit
// Body: { file: string (base64 PDF), ranges: [[start, end], ...] }
// Returns: { files: [base64, ...] }
'use strict';

const { PDFDocument } = require('pdf-lib');
const { requireJSON, validatePDFBase64 } = require('../../lib/validate');

async function splitPDF(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireJSON(req, res)) return;

  const { file, ranges } = req.body;
  const fileErr = validatePDFBase64(file);
  if (fileErr) return res.status(400).json({ error: fileErr });

  try {
    const srcDoc    = await PDFDocument.load(Buffer.from(file, 'base64'), { ignoreEncryption: true });
    const pageCount = srcDoc.getPageCount();

    // Default: split into individual pages
    const pageRanges = Array.isArray(ranges) && ranges.length > 0
      ? ranges
      : Array.from({ length: pageCount }, (_, i) => [i, i]);

    const results = [];
    for (const [start, end] of pageRanges) {
      const s = Math.max(0, Math.min(start, pageCount - 1));
      const e = Math.max(s, Math.min(end, pageCount - 1));
      const newDoc  = await PDFDocument.create();
      const indices = Array.from({ length: e - s + 1 }, (_, i) => s + i);
      const copied  = await newDoc.copyPages(srcDoc, indices);
      copied.forEach(p => newDoc.addPage(p));
      const bytes = await newDoc.save();
      results.push(Buffer.from(bytes).toString('base64'));
    }

    return res.status(200).json({ files: results, count: results.length, sourcePages: pageCount });
  } catch (e) {
    console.error('[pdfSplit]', e.message);
    return res.status(500).json({ error: 'PDF split failed: ' + e.message });
  }
}

module.exports = { splitPDF };
