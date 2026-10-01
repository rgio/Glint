/**
 * Fractional indexing for the Up Next queue: each item has a string sort key,
 * and inserting between two items creates a key between theirs, so a reorder
 * syncs as one changed row instead of renumbering the whole queue.
 */

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;

function digit(key: string, i: number): number {
  const ch = key[i];
  return ch === undefined ? 0 : DIGITS.indexOf(ch);
}

/**
 * Returns a key that sorts strictly between `before` and `after`.
 * Pass null for an open end. Keys never end in '0', so there is always room.
 */
export function sortKeyBetween(before: string | null, after: string | null): string {
  const lo = before ?? '';
  if (after !== null && lo >= after) {
    throw new Error(`sortKeyBetween: "${lo}" is not before "${after}"`);
  }

  let result = '';
  for (let i = 0; ; i++) {
    const a = digit(lo, i);
    const b = after === null ? BASE : i < after.length ? digit(after, i) : BASE;
    if (b - a > 1) {
      return result + DIGITS[Math.floor((a + b) / 2)];
    }
    // No room at this position: copy `a` and look one digit deeper. Once we
    // have gone past `after`'s prefix, the upper bound is open.
    result += DIGITS[a];
    if (a < b) after = null;
  }
}

/** Key for appending to the end of the queue ("play last"). */
export function sortKeyAfter(last: string | null): string {
  return sortKeyBetween(last, null);
}

/** Key for inserting at the front of the queue ("play next"). */
export function sortKeyBefore(first: string | null): string {
  return sortKeyBetween(null, first);
}
