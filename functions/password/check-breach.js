// password/check-breach.js
// Cloud Function: POST /checkBreach
// Body: { password: string }
// Returns: { pwned: boolean, count: number }
// Uses k-anonymity — password is hashed client-side and only prefix sent to HIBP.

'use strict';

const { checkPassword } = require('../lib/hibp');

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
async function checkBreach(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'password is required' });
  }

  if (password.length > 512) {
    return res.status(400).json({ error: 'password too long' });
  }

  try {
    const result = await checkPassword(password);
    // Never echo the password back
    return res.status(200).json({
      pwned: result.pwned,
      count: result.count,
    });
  } catch (e) {
    console.error('[checkBreach] error:', e.message);
    return res.status(502).json({ error: 'Upstream service unavailable. Try again later.' });
  }
}

module.exports = { checkBreach };
