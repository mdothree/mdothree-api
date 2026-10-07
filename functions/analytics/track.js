// analytics/track.js — Cloud Function: POST /trackEvent
// Lightweight anonymous event tracking stored in Firestore.
// Body: { event: string, tool: string, properties?: object }  (no uid/IP/UA stored)
'use strict';

const admin = require('firebase-admin');

const ALLOWED_EVENTS = new Set([
  'tool_used', 'hash_generated', 'password_generated', 'color_converted',
  'timestamp_converted', 'pdf_processed', 'image_processed', 'breach_checked',
  'palette_saved', 'preset_saved',
]);

async function trackEvent(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'POST only' }); return; }

  const { event, tool, properties = {} } = req.body || {};

  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: '"event" string is required' });
  }

  // Only track known event types to avoid abuse
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: `Unknown event type: ${event}` });
  }

  // Data minimisation (privacy policy: aggregate, non-identifying analytics):
  // no uid, IP address or user agent is stored, the tool name must look like a
  // slug, and properties keep at most 10 primitive values (strings <= 100 chars).
  const toolName = (typeof tool === 'string' && /^[a-z0-9-]{1,40}$/.test(tool)) ? tool : 'unknown';
  const props = {};
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [k, v] of Object.entries(properties).slice(0, 10)) {
      if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
      if (typeof v === 'number' || typeof v === 'boolean') props[k] = v;
      else if (typeof v === 'string') props[k] = v.slice(0, 100);
    }
  }

  try {
    const db = admin.firestore();
    await db.collection('analytics_events').add({
      event,
      tool:       toolName,
      properties: props,
      timestamp:  admin.firestore.FieldValue.serverTimestamp(),
    });

    // Also increment a daily counter (for dashboard aggregates)
    const today   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const counter = db.collection('analytics_daily').doc(`${today}_${toolName}_${event}`);
    await counter.set({
      date:  today,
      tool:  toolName,
      event,
      count: admin.firestore.FieldValue.increment(1),
    }, { merge: true });

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[trackEvent]', e.message);
    // Don't fail the client if analytics fails
    return res.status(200).json({ ok: false, note: 'analytics write failed silently' });
  }
}

module.exports = { trackEvent };
