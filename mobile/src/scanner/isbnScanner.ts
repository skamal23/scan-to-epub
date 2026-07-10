export function normalizeScannedISBN(value: string): string | null {
  const normalized = value.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  if (normalized.length !== 13 || !normalized.startsWith('978') && !normalized.startsWith('979')) {
    return null;
  }
  const weightedTotal = normalized
    .slice(0, 12)
    .split('')
    .reduce(
      (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
      0,
    );
  const checkDigit = (10 - weightedTotal % 10) % 10;
  return checkDigit === Number(normalized[12]) ? normalized : null;
}
