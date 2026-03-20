// stripe/webhook.js
// POST /api/stripe/webhook
// Handles Stripe webhook events to sync subscription status into Firestore.
// This is the authoritative source of truth for Pro status.
//
// Required Stripe events to enable in Dashboard:
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//   invoice.payment_succeeded
//   invoice.payment_failed
//   customer.subscription.trial_will_end

'use strict';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const admin  = require('firebase-admin');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function stripeWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify Stripe signature
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    // req.rawBody must be the raw buffer (set up in index.js with bodyParser.raw)
    event = stripe.webhooks.constructEvent(req.rawBody || req.body, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error('[webhook] signature verification failed:', e.message);
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  const db = admin.firestore();

  try {
    switch (event.type) {
      // ---- Subscription created / updated ----
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await syncSubscription(db, sub);
        break;
      }

      // ---- Subscription cancelled / expired ----
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = await getUIDFromCustomer(db, sub.customer);
        if (uid) {
          await db.collection('subscriptions').doc(uid).set({
            status:            'canceled',
            isPro:             false,
            canceledAt:        admin.firestore.FieldValue.serverTimestamp(),
            subscriptionId:    sub.id,
          }, { merge: true });
        }
        break;
      }

      // ---- Payment succeeded (invoice paid) ----
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await syncSubscription(db, sub);
        }
        break;
      }

      // ---- Payment failed ----
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const uid = await getUIDFromCustomer(db, invoice.customer);
        if (uid) {
          await db.collection('subscriptions').doc(uid).set({
            status:             'past_due',
            isPro:              false,
            lastPaymentFailure: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }
        break;
      }

      default:
        // Unhandled event — log and return 200 to avoid retries
        console.info('[webhook] unhandled event type:', event.type);
    }

    return res.status(200).json({ received: true });
  } catch (e) {
    console.error('[webhook] handler error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ---- Helpers ----

/**
 * Sync a Stripe Subscription object to Firestore.
 */
async function syncSubscription(db, sub) {
  const uid = sub.metadata?.firebaseUID ?? await getUIDFromCustomer(db, sub.customer);
  if (!uid) {
    console.warn('[webhook] no firebaseUID for customer:', sub.customer);
    return;
  }

  const isActive = sub.status === 'active' || sub.status === 'trialing';

  await db.collection('subscriptions').doc(uid).set({
    uid,
    stripeCustomerId:  sub.customer,
    subscriptionId:    sub.id,
    status:            sub.status,
    isPro:             isActive,
    plan:              isActive ? 'pro' : 'free',
    currentPeriodEnd:  admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000),
    currentPeriodStart:admin.firestore.Timestamp.fromMillis(sub.current_period_start * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    priceId:           sub.items?.data?.[0]?.price?.id ?? null,
    interval:          sub.items?.data?.[0]?.price?.recurring?.interval ?? null,
    updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.info(`[webhook] synced subscription ${sub.id} for uid ${uid} → ${sub.status}`);
}

/**
 * Look up Firebase UID from Stripe Customer ID via Firestore index.
 */
async function getUIDFromCustomer(db, customerId) {
  try {
    const snap = await db.collection('subscriptions')
      .where('stripeCustomerId', '==', customerId)
      .limit(1)
      .get();
    return snap.empty ? null : snap.docs[0].id; // doc ID = uid
  } catch {
    return null;
  }
}

module.exports = { stripeWebhook };
