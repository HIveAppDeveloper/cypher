"""Content-free app-entry to response-header timing, never full-body latency."""
import math
from time import perf_counter

HEADER = 'X-Cypher-App-Headers-Ms'
MAX_MS = 300000


async def app_header_timing(request, call_next):
    started = perf_counter()
    response = await call_next(request)
    elapsed = (perf_counter()-started)*1000
    # Never forward a stale/spoofed value or report a clamped duration as real.
    if HEADER in response.headers:
        del response.headers[HEADER]
    if math.isfinite(elapsed) and 0 <= elapsed <= MAX_MS:
        response.headers[HEADER] = f'{elapsed:.3f}'
    return response
