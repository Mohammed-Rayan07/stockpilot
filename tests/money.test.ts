import { expect, test } from 'vitest';
import { formatINR, toMajor, toMinor } from '@/lib/money';

// Proves toMinor/toMajor round-trip exactly in integer paise, and that formatINR's Indian
// digit grouping (lakh/crore) is display-only and never touches that arithmetic.

test('toMinor parses decimal strings into integer paise', () => {
  expect(toMinor('12.50')).toBe(1250);
  expect(toMinor('0.1')).toBe(10);
  expect(toMinor('100')).toBe(10000);
  expect(toMinor('-45.30')).toBe(-4530);
});

test('toMinor rounds half-up on the third decimal digit', () => {
  expect(toMinor('12.505')).toBe(1251);
  expect(toMinor('12.504')).toBe(1250);
  expect(toMinor('0.995')).toBe(100);
});

test('toMajor converts integer paise back to a decimal string', () => {
  expect(toMajor(1250)).toBe('12.50');
  expect(toMajor(10)).toBe('0.10');
  expect(toMajor(-4530)).toBe('-45.30');
  expect(toMajor(0)).toBe('0.00');
});

test('formatINR groups thousands Indian-style (lakh/crore)', () => {
  expect(formatINR('74912')).toBe('₹74,912.00');
  expect(formatINR('127370')).toBe('₹1,27,370.00');
  expect(formatINR('12345678.9')).toBe('₹1,23,45,678.90');
});

test('formatINR leaves amounts under 1,000 ungrouped', () => {
  expect(formatINR('12.5')).toBe('₹12.50');
  expect(formatINR('999')).toBe('₹999.00');
});

test('formatINR places the sign before the currency symbol', () => {
  expect(formatINR('-1250')).toBe('-₹1,250.00');
});
