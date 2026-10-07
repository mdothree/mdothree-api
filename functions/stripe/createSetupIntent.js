// stripe/createSetupIntent.js
// POST /api/stripe/create-setup-intent
// Creates (or retrieves) a Stripe Customer and returns a PaymentIntent client_secret
// for the embedded Stripe Payment Element.
// Body: { plan: 'monthly'|'yearly' }  (uid/email come from the verified ID token)

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin  = require('firebase-admin');
const { verifyAuthAndUID } = require('../lib/auth');

const PRICE_IDS = {
  monthly: process.env.STRIPE_PRICE_MONTHLY,
  yearly:  process.env.STRIPE_PRICE_YEARLY,
};

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function createSetupIntent(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Require a verified, NON-anonymous Firebase user; the uid comes from the token.
  // (verifyAuthAndUID was imported but never called, so anyone could create
  // Stripe customers/subscriptions bound to any uid.)
  if (!await verifyAuthAndUID(req, res, { allowAnonymous: false })) return;
  const uid = req.user.uid;
  const { plan = 'monthly' } = req.body || {};
  const email = typeof req.user.email === 'string' ? req.user.email : undefined;

  const priceId = Object.prototype.hasOwnProperty.call(PRICE_IDS, plan) ? PRICE_IDS[plan] : null;
  if (!priceId) return res.status(400).json({ error: `Unknown plan: ${plan}` });

  const db = admin.firestore();

  try {
    // ---- Get or create Stripe Customer ----
    let customerId;
    const subDoc = await db.collection('subscriptions').doc(uid).get();

    if (subDoc.exists && subDoc.data().stripeCustomerId) {
      customerId = subDoc.data().stripeCustomerId;
    } else {
      const customer = await stripe.customers.create({
        email,
        metadata: { firebaseUID: uid },
      });
      customerId = customer.id;
      // Persist customer ID immediately
      await db.collection('subscriptions').doc(uid).set({
        stripeCustomerId: customerId,
        status:           'none',
        uid,
      }, { merge: true });
    }

    // ---- Create a PaymentIntent for a subscription ----
    // We use a subscription + Payment Element flow:
    // 1. Create an incomplete subscription → gets a PaymentIntent client secret
    // 2. Client confirms payment → subscription activates → webhook fires
    const subscription = await stripe.subscriptions.create({
      customer:               customerId,
      items:                  [{ price: priceId }],
      payment_behavior:       'default_incomplete',
      payment_settings:       { save_default_payment_method: 'on_subscription' },
      expand:                 ['latest_invoice.payment_intent'],
      metadata:               { firebaseUID: uid },
    });

    const paymentIntent = subscription.latest_invoice.payment_intent;
    if (!paymentIntent) {
      return res.status(500).json({ error: 'Could not create payment intent' });
    }

    // Store pending subscription ID for the webhook to match
    await db.collection('subscriptions').doc(uid).set({
      pendingSubscriptionId: subscription.id,
    }, { merge: true });

    return res.status(200).json({
      clientSecret:   paymentIntent.client_secret,
      subscriptionId: subscription.id,
    });
  } catch (e) {
    console.error('[createSetupIntent]', e.message);
    return res.status(500).json({ error: e.message });
  }
}

module.exports = { createSetupIntent };
