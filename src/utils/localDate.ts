const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A YYYY-MM-DD key in the Date's local timezone. */
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * Move by local calendar days rather than fixed 24-hour periods. Anchoring at
 * noon keeps the calculation stable across daylight-saving transitions.
 */
export function localDateAtOffset(date: Date, days: number): Date {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  next.setDate(next.getDate() + Math.trunc(days));
  return next;
}

export function localDateKeyAtOffset(date: Date, days: number): string {
  return localDateKey(localDateAtOffset(date, days));
}

/** Parse a date-only key as a local calendar date, never as UTC. */
export function parseLocalDateKey(key: string): Date | null {
  const match = DATE_KEY.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return localDateKey(date) === key ? date : null;
}

export function isLocalDateKey(value: unknown): value is string {
  return typeof value === 'string' && parseLocalDateKey(value) !== null;
}
