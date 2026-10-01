'use strict';

// Everything the pages need is served from this server, so the policy can be strict:
// no inline scripts, no third-party code, and only our own pages may frame Mama's phone.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

const HEADERS = {
  'Content-Security-Policy':      CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options':       'nosniff',
  'X-Frame-Options':              'SAMEORIGIN',
  'Referrer-Policy':              'no-referrer',
  'Cross-Origin-Opener-Policy':   'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy':           'camera=(), microphone=(), geolocation=(), payment=()',
};

/** Sets browser security headers on every response. */
function securityHeaders(req, res, next) {
  res.set(HEADERS);
  next();
}

module.exports = { securityHeaders };
