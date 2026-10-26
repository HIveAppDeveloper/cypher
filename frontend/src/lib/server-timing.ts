const MAX_TIMING_MS = 300_000;

function duration(value: number | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIMING_MS
    ? value.toFixed(2) : null;
}

/** Headers-ready timings only: never includes complete stream download or playback. */
export function proxyServerTiming(upstreamMs: number | undefined, proxyMs: number, appHeader: string | null = null): string {
  const values: string[] = [];
  const upstream = duration(upstreamMs), proxy = duration(proxyMs);
  if (upstream !== null) values.push(`cypher_upstream_headers;dur=${upstream}`);
  if (proxy !== null) values.push(`cypher_proxy_headers;dur=${proxy}`);
  // The backend contributes only one bounded numeric value, never arbitrary
  // Server-Timing descriptions, headers, identifiers or provider data.
  if (appHeader !== null && appHeader.length <= 32) {
    const normalized = appHeader.trim();
    if (/^\d{1,6}(?:\.\d{1,6})?$/.test(normalized)) {
      const app = duration(Number(normalized));
      if (app !== null) values.push(`cypher_app_headers;dur=${app}`);
    }
  }
  return values.join(', ');
}
