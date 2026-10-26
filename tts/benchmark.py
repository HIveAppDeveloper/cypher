"""Measure first nonempty audio byte, not HTTP headers. Never prints credentials."""
import argparse
import json
import os
import statistics
import time
import urllib.error
import urllib.request


def measure(url, mode, text, audio_format):
    headers = {"Content-Type": "application/json"}
    if mode == "cypher":
        cookie = os.environ.get("CYPHER_BENCH_COOKIE")
        if cookie:
            headers["Cookie"] = cookie
        payload = {"text": text}
    else:
        key = os.environ.get("GROKBOT_BACKEND_API_TOKEN") or os.environ.get("BACKEND_API_TOKEN")
        if not key:
            raise RuntimeError("Set the service authentication token securely in the environment.")
        headers["Authorization"] = "Bearer " + key
        payload = {"input": text, "model": "kokoro", "voice": "af_bella", "response_format": audio_format}
    start = time.perf_counter()
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
    # Redirects are deliberately refused so auth cannot leak to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
        headers_ms = (time.perf_counter() - start) * 1000
        content_type = response.headers.get("Content-Type", "").split(";")[0]
        if content_type not in {"audio/pcm", "audio/mpeg"}:
            raise RuntimeError("The endpoint returned something other than audio.")
        first = response.read(2 if content_type == "audio/pcm" else 1)
        if not first:
            raise RuntimeError("The endpoint returned no audio.")
        first_audio_ms = (time.perf_counter() - start) * 1000
        total = len(first)
        while block := response.read(16384):
            total += len(block)
        if content_type == "audio/pcm" and total % 2:
            raise RuntimeError("The PCM stream ended mid-sample.")
        timing = response.headers.get("Server-Timing", "")
        return {"headers_ms": round(headers_ms, 3), "network_first_audio_ms": round(first_audio_ms, 3), "total_ms": round((time.perf_counter() - start) * 1000, 3), "audio_bytes": total, "format": content_type, "server_timing": timing}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--mode", choices=["service", "cypher"], default="cypher")
    parser.add_argument("--format", choices=["pcm", "mp3"], default="pcm")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--text", default="Check pipeline latency.")
    args = parser.parse_args()
    if not 1 <= args.runs <= 20:
        parser.error("Use 1–20 measured runs.")
    # Nonblank warmups exercise phonemization, inference and encoding.
    warmups = [measure(args.url, args.mode, "Warm up voice.", args.format) for _ in range(3)]
    results = [measure(args.url, args.mode, args.text, args.format) for _ in range(args.runs)]
    print(json.dumps({"warmups": warmups, "samples": results, "median_network_first_audio_ms": statistics.median(r["network_first_audio_ms"] for r in results), "under_20ms_all_samples": all(r["network_first_audio_ms"] < 20 for r in results)}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Voice endpoint returned HTTP {error.code}; response body omitted.") from None
