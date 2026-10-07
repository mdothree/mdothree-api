// image/convert.js — Cloud Function: POST /imageConvert
// Body: { file: string (base64), fromMime: string, toMime: string, quality?: number }
// Returns: { file: string (base64), mimeType, bytes }
'use strict';

const sharp = require('sharp');
const { requireJSON, validateImageBase64 } = require('../lib/validate');

const SUPPORTED_OUTPUT = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/tiff']);

async function convertImage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireJSON(req, res)) return;

  const { file, toMime, quality = 85 } = req.body;
  const fileErr = validateImageBase64(file);
  if (fileErr) return res.status(400).json({ error: fileErr });
  if (!toMime) return res.status(400).json({ error: '"toMime" target format is required' });

  const targetMime = toMime.toLowerCase();
  if (!SUPPORTED_OUTPUT.has(targetMime)) {
    return res.status(400).json({ error: `Unsupported output format: ${toMime}. Supported: ${[...SUPPORTED_OUTPUT].join(', ')}` });
  }

  try {
    const inputBuffer = Buffer.from(file, 'base64');
    const img         = sharp(inputBuffer);
    let outputBuffer;

    switch (targetMime) {
      case 'image/jpeg': outputBuffer = await img.jpeg({ quality: parseInt(quality), mozjpeg: true }).toBuffer(); break;
      case 'image/png':  outputBuffer = await img.png({ compressionLevel: 7 }).toBuffer(); break;
      case 'image/webp': outputBuffer = await img.webp({ quality: parseInt(quality) }).toBuffer(); break;
      case 'image/avif': outputBuffer = await img.avif({ quality: parseInt(quality) }).toBuffer(); break;
      case 'image/gif':  outputBuffer = await img.gif().toBuffer(); break;
      case 'image/tiff': outputBuffer = await img.tiff().toBuffer(); break;
      default:           outputBuffer = await img.jpeg({ quality: 85 }).toBuffer();
    }

    const meta = await sharp(outputBuffer).metadata();

    return res.status(200).json({
      file:     outputBuffer.toString('base64'),
      mimeType: targetMime,
      width:    meta.width,
      height:   meta.height,
      bytes:    outputBuffer.length,
    });
  } catch (e) {
    console.error('[imageConvert]', e.message);
    return res.status(500).json({ error: 'Image conversion failed: ' + e.message });
  }
}

module.exports = { convertImage };
