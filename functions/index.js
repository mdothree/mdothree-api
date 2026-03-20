// functions/index.js — mdothree-api
// Firebase Cloud Functions entry point.
// Deploy: firebase deploy --only functions

const functions   = require('firebase-functions');
const admin       = require('firebase-admin');
const bodyParser  = require('body-parser');
const express     = require('express');

// Initialise Admin SDK (uses default credentials in Cloud Functions environment)
if (!admin.apps.length) admin.initializeApp();

// ---- Rate limiting ----
const { RateLimiter } = require('./lib/rateLimiter');
const limiter = new RateLimiter({
  windowMs:  60 * 1000,
  maxPerMin: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60'),
});

// ---- CORS helper ----
function cors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,stripe-signature');
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  next ? next() : undefined;
}

// ============================================================
// PDF functions
// ============================================================
const { mergePDF }    = require('./pdf/merge');
const { splitPDF }    = require('./pdf/split');
const { compressPDF } = require('./pdf/compress');

exports.pdfMerge    = functions.https.onRequest((req, res) => { cors(req, res); limiter.wrap(mergePDF)(req, res); });
exports.pdfSplit    = functions.https.onRequest((req, res) => { cors(req, res); limiter.wrap(splitPDF)(req, res); });
exports.pdfCompress = functions.https.onRequest((req, res) => { cors(req, res); limiter.wrap(compressPDF)(req, res); });

// ============================================================
// Image functions
// ============================================================
const { resizeImage }  = require('./image/resize');
const { convertImage } = require('./image/convert');

exports.imageResize  = functions.https.onRequest((req, res) => { cors(req, res); limiter.wrap(resizeImage)(req, res); });
exports.imageConvert = functions.https.onRequest((req, res) => { cors(req, res); limiter.wrap(convertImage)(req, res); });

// ============================================================
// Password breach check
// ============================================================
const { checkBreach } = require('./password/check-breach');
exports.checkBreach   = functions.https.onRequest((req, res) => { cors(req, res); limiter.wrap(checkBreach)(req, res); });

// ============================================================
// Analytics
// ============================================================
const { trackEvent } = require('./analytics/track');
exports.trackEvent   = functions.https.onRequest((req, res) => { cors(req, res); trackEvent(req, res); });

// ============================================================
// Stripe — Express sub-app (needed for raw body on webhook)
// ============================================================
const { createSetupIntent }   = require('./stripe/createSetupIntent');
const { stripeWebhook }       = require('./stripe/webhook');
const { createPortalSession } = require('./stripe/customerPortal');

const stripeApp = express();

// Webhook route MUST receive raw body for signature verification
stripeApp.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  (req, res) => {
    req.rawBody = req.body; // expose for stripe.webhooks.constructEvent
    cors(req, res);
    stripeWebhook(req, res);
  }
);

// All other Stripe routes use JSON body
stripeApp.use(bodyParser.json());
stripeApp.use((req, res, next) => { cors(req, res, next); });

stripeApp.post('/create-setup-intent', (req, res) => limiter.wrap(createSetupIntent)(req, res));
stripeApp.post('/portal',              (req, res) => limiter.wrap(createPortalSession)(req, res));

// Expose as a single Cloud Function at /api/stripe/*
exports.stripe = functions.https.onRequest(stripeApp);

// Also expose individual named exports for direct calls
exports.stripeCreateSetupIntent = functions.https.onRequest(
  (req, res) => { cors(req, res); limiter.wrap(createSetupIntent)(req, res); }
);
exports.stripePortal = functions.https.onRequest(
  (req, res) => { cors(req, res); limiter.wrap(createPortalSession)(req, res); }
);
// Webhook must NOT be rate-limited (Stripe retries)
exports.stripeWebhook = functions.https.onRequest(
  (req, res) => {
    req.rawBody = req.body;
    cors(req, res);
    stripeWebhook(req, res);
  }
);
