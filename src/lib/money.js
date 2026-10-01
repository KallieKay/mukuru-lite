'use strict';

// All money is held as integer cents and rates as integer micro-units,
// so no calculation ever depends on floating-point rounding.

const RATE_SCALE = 1_000_000;

/** Parses user input such as "1500" or "1500.50" into cents, or null if invalid. */
function parseRands(input) {
  const text = String(input ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

const toRateUnits = rate => Math.round(rate * RATE_SCALE);

/** Converts cents at a rate held in micro-units, rounding half up to the nearest cent. */
const convert = (cents, rateUnits) => Math.round((cents * rateUnits) / RATE_SCALE);

/**
 * Fee = flat + percentage, rounded down so any rounding favours the customer.
 * @param {number} amountCents
 * @param {{ flatCents: number, percentBps: number, roundDownToCents: number }} fees
 */
function calculateFee(amountCents, { flatCents, percentBps, roundDownToCents }) {
  const raw = flatCents + Math.floor((amountCents * percentBps) / 10_000);
  return Math.floor(raw / roundDownToCents) * roundDownToCents;
}

/** Formats cents for display: whole amounts drop the ".00" ("R1500", "$94.58"). */
function formatMoney(cents, symbol) {
  const value = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return `${symbol}${value}`;
}

module.exports = { RATE_SCALE, parseRands, toRateUnits, convert, calculateFee, formatMoney };
