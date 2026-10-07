// lib/auth.js — Firebase Admin ID token verification
// Used by Stripe functions that operate on per-user data.
// PDF/image functions are intentionally public (no auth required).
'use strict';

const admin = require('firebase-admin');

/**
 * Verify the Firebase ID token from the Authorization header.
 * Attaches decoded token to req.user on success.
 *
 * Usage:
 *   const { verifyAuth } = require('../lib/auth');
 *   async function myFn(req, res) {
 *     if (!await verifyAuth(req, res)) return;  // 401 already sent
 *     const uid = req.user.uid;
 *     ...
 *   }
 *
 * Client must send:
 *   Authorization: Bearer <Firebase ID token>
 *
 * Get the token on the client:
 *   const token = await firebase.auth().currentUser.getIdToken();
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {{allowAnonymous?: boolean}} [opts] allowAnonymous:false → 403 for anonymous-auth tokens
 * @returns {Promise<boolean>} true if authenticated, false if rejected (response already sent)
 */
async function verifyAuth(req, res, { allowAnonymous = true } = {}) {
  const authHeader = req.headers.authorization || '';

  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Missing Authorization header. Send: Authorization: Bearer <Firebase ID token>',
    });
    return false;
  }

  const idToken = authHeader.slice(7);

  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    if (!allowAnonymous && decoded.firebase?.sign_in_provider === 'anonymous') {
      // Anonymous uids are per-browser and per-subdomain, and anyone can mint them
      // with the public web key: never attach a paid subscription to one.
      res.status(403).json({ error: 'Create an account (not a guest session) to subscribe.', code: 'anonymous_not_allowed' });
      return false;
    }
    req.user = decoded; // attach { uid, email, ... } to request
    return true;
  } catch (e) {
    const code = e.code || '';

    if (code === 'auth/id-token-expired') {
      res.status(401).json({ error: 'Token expired — re-authenticate and retry.' });
    } else if (code === 'auth/argument-error' || code === 'auth/invalid-id-token') {
      res.status(401).json({ error: 'Invalid ID token.' });
    } else {
      console.error('[auth] verifyIdToken failed:', e.message);
      res.status(401).json({ error: 'Authentication failed.' });
    }
    return false;
  }
}

/**
 * Verify auth AND confirm the uid in the request body matches the token.
 * Prevents one authenticated user from acting on another user's data.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<boolean>}
 */
async function verifyAuthAndUID(req, res, opts = {}) {
  if (!await verifyAuth(req, res, opts)) return false;

  const bodyUID = req.body?.uid;
  if (bodyUID && bodyUID !== req.user.uid) {
    res.status(403).json({
      error: 'UID in request body does not match authenticated user.',
    });
    return false;
  }

  return true;
}

module.exports = { verifyAuth, verifyAuthAndUID };
