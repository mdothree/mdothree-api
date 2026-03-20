// analytics/track.js — Cloud Function: POST /trackEvent
// Lightweight anonymous event tracking stored in Firestore.
// Body: { event: string, tool: string, properties?: object }
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

  const { event, tool, uid, properties = {} } = req.body;

  if (!event || typeof event !== 'string') {
    return res.status(400).json({ error: '"event" string is required' });
  }

  // Only track known event types to avoid abuse
  if (!ALLOWED_EVENTS.has(event)) {
    return res.status(400).json({ error: `Unknown event type: ${event}` });
  }

  try {
    const db = admin.firestore();
    await db.collection('analytics_events').add({
      event,
      tool:       tool        ?? 'unknown',
      uid:        uid         ?? null,
      properties: typeof properties === 'object' ? properties : {},
      ip:         req.headers['x-forwarded-for']?.split(',')[0].trim() ?? null,
      userAgent:  req.headers['user-agent'] ?? null,
      timestamp:  admin.firestore.FieldValue.serverTimestamp(),
    });

    // Also increment a daily counter (for dashboard aggregates)
    const today   = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const counter = db.collection('analytics_daily').doc(`${today}_${tool}_${event}`);
    await counter.set({
      date:  today,
      tool:  tool ?? 'unknown',
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
