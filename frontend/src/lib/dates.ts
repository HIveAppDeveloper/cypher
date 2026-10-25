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
