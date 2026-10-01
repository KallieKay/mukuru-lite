'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRands, calculateFee, convert, toRateUnits, formatMoney } = require('../src/lib/money');
const { fees } = require('../data/seed.json');

test('parseRands accepts whole and two-decimal amounts only', () => {
  assert.equal(parseRands('1500'), 150000);
  assert.equal(parseRands('1500.5'), 150050);
  assert.equal(parseRands(' 99.99 '), 9999);
  for (const bad of ['', 'abc', '-5', '1.234', '1e3', '15 00', null, undefined]) {
    assert.equal(parseRands(bad), null, `expected ${bad} to be rejected`);
  }
});

test('fee is R20 + 1.67%, rounded down to whole rands', () => {
  assert.equal(calculateFee(150000, fees), 4500);   // R45.05 -> R45
  assert.equal(calculateFee(5000, fees), 2000);     // R20.83 -> R20
});

test('conversion uses integer maths and rounds half up', () => {
  assert.equal(convert(145500, toRateUnits(0.065)), 9458);  // 9457.5 cents -> $94.58
});

test('formatMoney drops .00 on whole amounts', () => {
  assert.equal(formatMoney(150000, 'R'), 'R1500');
  assert.equal(formatMoney(9458, '$'), '$94.58');
});
