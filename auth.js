'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getSession } = require('../engine/state');

// The value shipped in config/.env.example is public, so it must never sign tokens in production.
const PLACEHOLDER = 'change-me-to-a-long-random-string';
function resolveSecret(env = process.env) {
  const given = env.JWT_SECRET;
  if (!given) { console.warn('[warn] JWT_SECRET not set; using a random per-process secret.'); return crypto.randomBytes(32).toString('hex'); }
  const weak = given === PLACEHOLDER || given.length < 32;
  if (weak && env.NODE_ENV === 'production') throw new Error('JWT_SECRET is the example placeholder or shorter than 32 characters. Set a long random value.');
  if (weak) console.warn('[warn] JWT_SECRET is the example placeholder or shorter than 32 characters.');
  return given;
}
const SECRET = resolveSecret();

const sign = sid => jwt.sign({ sid }, SECRET, { algorithm: 'HS256', expiresIn: '2h' });
const fail = (res, code, msg) => res.status(401).json({ error: { code, message: msg } });

// Verifies signature (HS256 only) and expiry, then loads the server-side session.
function auth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return fail(res, 'NO_TOKEN', 'Missing bearer token.');
  let payload;
  try { payload = jwt.verify(m[1], SECRET, { algorithms: ['HS256'] }); }
  catch (e) { return fail(res, e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'BAD_TOKEN', 'Invalid or expired token.'); }
  const s = getSession(payload.sid);
  if (!s) return fail(res, 'NO_SESSION', 'Session not found. Start a new one.');
  req.session = s;
  next();
}

module.exports = { auth, sign, SECRET, resolveSecret };
