// image/resize.js — Cloud Function: POST /imageResize
// Body: { file: string (base64), mimeType: string, width?: number, height?: number, fit?: 'cover'|'contain'|'fill' }
// Returns: { file: string (base64), width, height, mimeType }
'use strict';

const sharp = require('sharp');
const { requireJSON, validateImageBase64 } = require('../lib/validate');

async function resizeImage(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireJSON(req, res)) return;

  const { file, mimeType = 'image/jpeg', width, height, fit = 'cover', quality = 85 } = req.body;
  const fileErr = validateImageBase64(file);
  if (fileErr) return res.status(400).json({ error: fileErr });
  if (!width && !height) return res.status(400).json({ error: 'Provide at least "width" or "height"' });

  const MAX_DIMENSION = 8000;
  if ((width && width > MAX_DIMENSION) || (height && height > MAX_DIMENSION)) {
    return res.status(400).json({ error: `Max dimension is ${MAX_DIMENSION}px` });
  }

  try {
    const inputBuffer = Buffer.from(file, 'base64');
    const pipeline    = sharp(inputBuffer).resize({
      width:  width  ? parseInt(width)  : undefined,
      height: height ? parseInt(height) : undefined,
      fit,
      withoutEnlargement: false,
    });

    let outputBuffer;
    let outputMime = mimeType;

    switch (mimeType) {
      case 'image/jpeg':
      case 'image/jpg':
        outputBuffer = await pipeline.jpeg({ quality: parseInt(quality) }).toBuffer();
        outputMime   = 'image/jpeg';
        break;
      case 'image/png':
        outputBuffer = await pipeline.png({ compressionLevel: 6 }).toBuffer();
        break;
      case 'image/webp':
        outputBuffer = await pipeline.webp({ quality: parseInt(quality) }).toBuffer();
        break;
      case 'image/avif':
        outputBuffer = await pipeline.avif({ quality: parseInt(quality) }).toBuffer();
        break;
      default:
        outputBuffer = await pipeline.jpeg({ quality: parseInt(quality) }).toBuffer();
        outputMime   = 'image/jpeg';
    }

    const meta = await sharp(outputBuffer).metadata();

    return res.status(200).json({
      file:     outputBuffer.toString('base64'),
      mimeType: outputMime,
      width:    meta.width,
      height:   meta.height,
      bytes:    outputBuffer.length,
    });
  } catch (e) {
    console.error('[imageResize]', e.message);
    return res.status(500).json({ error: 'Image resize failed: ' + e.message });
  }
}

module.exports = { resizeImage };
