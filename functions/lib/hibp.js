// lib/hibp.js — HaveIBeenPwned k-Anonymity API helper
'use strict';

const https   = require('https');
const crypto  = require('crypto');
const functions = require('firebase-functions');

const HIBP_API_KEY = process.env.HIBP_API_KEY || functions.config().hibp?.api_key || '';

/**
 * SHA-1 hash a string (hex, uppercase).
 * @param {string} password
 * @returns {string}
 */
function sha1(password) {
  return crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
}

/**
 * Fetch the HIBP range endpoint for a 5-char prefix.
 * @param {string} prefix
 * @returns {Promise<string>} raw response body (hash suffixes + counts)
 */
function fetchRange(prefix) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.pwnedpasswords.com',
      path:     '/range/' + prefix,
      method:   'GET',
      headers: {
        'User-Agent': 'mdothree-password-checker/1.0',
        ...(HIBP_API_KEY ? { 'hibp-api-key': HIBP_API_KEY } : {}),
      },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('HIBP timeout')); });
    req.end();
  });
}

/**
 * Check if a password appears in the HIBP database.
 * Uses k-anonymity — only the first 5 chars of the SHA-1 hash are sent.
 *
 * @param {string} password
 * @returns {Promise<{ pwned: boolean, count: number, hash: string }>}
 */
async function checkPassword(password) {
  const hash   = sha1(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  const body  = await fetchRange(prefix);
  const lines = body.split('\r\n');

  for (const line of lines) {
    const [lineSuffix, count] = line.split(':');
    if (lineSuffix === suffix) {
      return { pwned: true, count: parseInt(count, 10), hash };
    }
  }
  return { pwned: false, count: 0, hash };
}

module.exports = { checkPassword, sha1 };
