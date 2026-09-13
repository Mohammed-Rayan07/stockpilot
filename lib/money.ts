// All money in this codebase is handled as integer minor units (paise).
//
// Postgres `numeric` is returned by the driver as a STRING, deliberately: numeric
// carries more precision than a JS number. Floating point cannot represent 0.1
// exactly, so repeated float arithmetic on currency accumulates error. The rule is:
// convert to minor units, do integer arithmetic, round once, convert back.

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * "12.50" -> 1250. Parses the decimal string digit-by-digit rather than doing
 * Number(v) * 100, because that multiply is exactly the float operation this
 * module exists to avoid.
 */
export function toMinor(v: string | number): number {
  const raw = typeof v === 'number' ? String(v) : v.trim();

  if (!DECIMAL_PATTERN.test(raw)) {
    throw new Error(`Not a valid decimal amount: ${JSON.stringify(v)}`);
  }

  const isNegative = raw.startsWith('-');
  const unsigned = isNegative ? raw.slice(1) : raw;
  const [integerPart, fractionPart = ''] = unsigned.split('.');

  const paddedFraction = fractionPart.padEnd(3, '0');
  let paise = Number(paddedFraction.slice(0, 2));
  let rupees = Number(integerPart);

  // Round half-up on the third decimal digit. This is the single rounding step;
  // callers must not round again.
  if (Number(paddedFraction[2]) >= 5) {
    paise += 1;
    if (paise === 100) {
      paise = 0;
      rupees += 1;
    }
  }

  const magnitude = rupees * 100 + paise;

  if (!Number.isSafeInteger(magnitude)) {
    throw new Error(`Amount out of safe integer range: ${raw}`);
  }

  return isNegative ? -magnitude : magnitude;
}

/** 1250 -> "12.50". The string form is what Postgres `numeric` columns accept. */
export function toMajor(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`Minor units must be an integer, received: ${minor}`);
  }

  const sign = minor < 0 ? '-' : '';
  const magnitude = Math.abs(minor);
  const rupees = Math.floor(magnitude / 100);
  const paise = magnitude % 100;

  return `${sign}${rupees}.${String(paise).padStart(2, '0')}`;
}

/**
 * Groups an unsigned run of digits Indian-style (lakh/crore): the last 3 digits form one
 * group, everything before that groups in pairs. "127370" -> "1,27,370".
 */
function groupIndian(digits: string): string {
  if (digits.length <= 3) {
    return digits;
  }

  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');

  return `${rest},${last3}`;
}

/** "12.50" -> "₹12.50", "127370" -> "₹1,27,370.00". Display only; never feed the result
 * back into arithmetic. */
export function formatINR(v: string | number): string {
  const major = toMajor(toMinor(v));
  const isNegative = major.startsWith('-');
  const [integerPart, fractionPart] = (isNegative ? major.slice(1) : major).split('.');

  return `${isNegative ? '-' : ''}₹${groupIndian(integerPart)}.${fractionPart}`;
}
