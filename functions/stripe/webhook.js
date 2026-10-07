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
//
// Hardening (2026-10-07):
//   - Pro is granted only for this product's prices (STRIPE_PRICE_MONTHLY/YEARLY);
//     the MDO3 Stripe account sells other subscriptions.
//   - Pro is never granted to an anonymous Firebase user (guest uids are per
//     browser + per subdomain and free to mint), even if a subscription names one.
//   - Out-of-order delivery: writes skip an event older than the last applied one
//     (lastEventCreated), so a late event cannot resurrect a canceled plan.
//     Re-delivery of the same event is a no-op merge (idempotent).

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
        await syncSubscription(db, sub, event);
        break;
      }

      // ---- Subscription cancelled / expired ----
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const uid = await getUIDFromCustomer(db, sub.customer);
        if (uid) {
          await writeSub(db, uid, event, {
            status:            'canceled',
            isPro:             false,
            plan:              'free',
            canceledAt:        admin.firestore.FieldValue.serverTimestamp(),
            subscriptionId:    sub.id,
          });
        }
        break;
      }

      // ---- Payment succeeded (invoice paid) ----
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          await syncSubscription(db, sub, event);
        }
        break;
      }

      // ---- Payment failed ----
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const uid = await getUIDFromCustomer(db, invoice.customer);
        if (uid) {
          await writeSub(db, uid, event, {
            status:             'past_due',
            isPro:              false,
            plan:               'free',
            lastPaymentFailure: admin.firestore.FieldValue.serverTimestamp(),
          });
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
async function syncSubscription(db, sub, event) {
  const uid = sub.metadata?.firebaseUID ?? await getUIDFromCustomer(db, sub.customer);
  if (!uid) {
    console.warn('[webhook] no firebaseUID for customer:', sub.customer);
    return;
  }

  const priceId  = sub.items?.data?.[0]?.price?.id ?? null;
  const known    = [process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_YEARLY].filter(Boolean);
  if (!priceId || !known.includes(priceId)) {
    console.warn(`[webhook] subscription ${sub.id}: price ${priceId} is not an mdothree price; ignored`);
    return;
  }
  const active   = sub.status === 'active' || sub.status === 'trialing';
  const isPro    = active && await isRegisteredUser(uid);

  await writeSub(db, uid, event, {
    uid,
    stripeCustomerId:  sub.customer,
    subscriptionId:    sub.id,
    status:            sub.status,
    isPro,
    plan:              isPro ? 'pro' : 'free',
    currentPeriodEnd:  admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000),
    currentPeriodStart:admin.firestore.Timestamp.fromMillis(sub.current_period_start * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    priceId,
    interval:          sub.items?.data?.[0]?.price?.recurring?.interval ?? null,
  });

  console.info(`[webhook] synced subscription ${sub.id} for uid ${uid} → ${sub.status} (isPro=${isPro})`);
}

/** True for a real (non-anonymous) Firebase Auth user. */
async function isRegisteredUser(uid) {
  try {
    const user = await admin.auth().getUser(uid);
    return Array.isArray(user.providerData) && user.providerData.length > 0;
  } catch (e) {
    console.warn('[webhook] getUser failed for', uid, e.code || e.message);
    return false;
  }
}

/** Merge-write subscriptions/{uid} unless a newer Stripe event was already applied. */
async function writeSub(db, uid, event, data) {
  const ref = db.collection('subscriptions').doc(uid);
  const created = Number(event?.created) || 0;
  await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    const last = snap.exists ? Number(snap.data().lastEventCreated) || 0 : 0;
    if (created && last && created < last) {
      console.info(`[webhook] stale ${event.type} ${event.id} for ${uid} skipped`);
      return;
    }
    t.set(ref, {
      ...data,
      lastEventCreated: Math.max(created, last),
      lastEventId:      event?.id ?? null,
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
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
