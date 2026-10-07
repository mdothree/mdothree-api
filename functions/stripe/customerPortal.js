// stripe/customerPortal.js
// POST /api/stripe/portal
// Creates a Stripe Customer Portal session and returns the URL.
// The user clicks "Manage billing" → we redirect them to Stripe's hosted portal.
// Body: { uid: string, returnUrl?: string }

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin  = require('firebase-admin');
const { verifyAuthAndUID } = require('../lib/auth');

async function createPortalSession(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Require authentication — only the account owner can access their billing portal
  if (!await verifyAuthAndUID(req, res)) return;

  const uid = req.user.uid;  // always use the verified uid, never trust req.body.uid alone
  const { returnUrl } = req.body;

  const db = admin.firestore();

  try {
    const subDoc = await db.collection('subscriptions').doc(uid).get();
    if (!subDoc.exists || !subDoc.data().stripeCustomerId) {
      return res.status(404).json({ error: 'No subscription found for this user' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer:   subDoc.data().stripeCustomerId,
      return_url: returnUrl ?? 'https://mdothree.com',
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('[customerPortal]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = { createPortalSession };
