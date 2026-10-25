const EXPLICIT_TIME_ZONE = /(?:z|[+-]\d{2}:?\d{2})$/i;

/** Parse API timestamps consistently: naive server timestamps are UTC; explicit offsets are preserved. */
export function dateFromApi(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim();
  const hasTimeZone = EXPLICIT_TIME_ZONE.test(normalized);
  const isoCompatible = normalized.replace(/z$/i, 'Z').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const withoutTimeZone = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00Z` : `${normalized}Z`;
  const date = new Date(hasTimeZone ? isoCompatible : withoutTimeZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar-only fields keep their stated day; timestamp inputs still use the viewer's local date. */
export function calendarDateLabel(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const date = dateFromApi(normalized);
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return date.toLocaleDateString();
  if (date.toISOString().slice(0, 10) !== normalized) return null;
  return date.toLocaleDateString(undefined, { timeZone: 'UTC' });
}
