'use strict';

const crypto = require('node:crypto');

// PINs and collection codes are only ever stored as salted scrypt hashes.

const derive = (secret, salt) => crypto.scryptSync(String(secret ?? ''), salt, 32);

/** @returns {{ salt: Buffer, hash: Buffer }} */
function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  return { salt, hash: derive(secret, salt) };
}

/** Constant-time comparison, so response timing gives nothing away. */
const verifySecret = (secret, { salt, hash }) => crypto.timingSafeEqual(derive(secret, salt), hash);

/** A random numeric code such as "048213". */
const numericCode = digits => String(crypto.randomInt(0, 10 ** digits)).padStart(digits, '0');

module.exports = { hashSecret, verifySecret, numericCode };
