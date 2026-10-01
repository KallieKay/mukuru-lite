'use strict';

/**
 * An expected failure with a stable machine-readable code.
 * Routes turn it into an HTTP response; the USSD channel turns it into a menu message.
 */
class AppError extends Error {
  constructor(code, status, details = {}) {
    super(code);
    this.name    = 'AppError';
    this.code    = code;
    this.status  = status;
    this.details = details;
  }
}

module.exports = { AppError };
