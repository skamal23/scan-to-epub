import { normalizeScannedISBN } from '../isbnScanner';

describe('normalizeScannedISBN', () => {
  test.each([
    ['9780141439518', '9780141439518'],
    ['978-0-14-143951-8', '9780141439518'],
    ['9791090636071', '9791090636071'],
  ])('accepts a valid book EAN-13 (%s)', (raw, expected) => {
    expect(normalizeScannedISBN(raw)).toBe(expected);
  });

  test.each([
    '9770141439518',
    '9780141439519',
    '978014143951',
    'not-a-barcode',
    'prefix9780141439518suffix',
  ])('rejects an invalid or non-book barcode (%s)', (raw) => {
    expect(normalizeScannedISBN(raw)).toBeNull();
  });
});
