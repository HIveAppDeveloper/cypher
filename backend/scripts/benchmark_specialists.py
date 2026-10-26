"""Offline catalog/context benchmark. No model, database, or network calls.

Run from backend/: python scripts/benchmark_specialists.py
Timing is local Python retrieval only, never a chat latency or provider-cost SLA.
"""
import json
from pathlib import Path
import sys
from time import perf_counter
import statistics

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.specialist_catalog import DOMAINS, PROCEDURES, CATALOG_SIZE, get_skill, search_skills, task_skill_prompt

QUERIES = ('Python concurrency race review', 'postgres database migration plan',
           'email rewrite', 'budget cost review', 'climate research brief', 'marketing comparison')


def main():
    durations = []
    for i in range(1200):
        start = perf_counter()
        search_skills(QUERIES[i % len(QUERIES)])
        durations.append((perf_counter()-start)*1000)
    durations.sort()
    full_chars = sum(len(get_skill(d.id+'.'+p.id)['instructions']) for d in DOMAINS for p in PROCEDURES)
    selected_chars = max(len(task_skill_prompt(query)) for query in QUERIES)
    print(json.dumps({
        'mode': 'offline_local_only', 'catalog_profiles': CATALOG_SIZE,
        'domain_count': len(DOMAINS), 'procedure_count': len(PROCEDURES),
        'queries': len(durations),
        'retrieval_ms': {'median': round(statistics.median(durations), 4),
                         'p90': round(durations[1079], 4), 'p95': round(durations[1139], 4),
                         'p99': round(durations[1187], 4), 'max': round(max(durations), 4)},
        'full_catalog_instruction_chars_never_sent': full_chars,
        'selected_instruction_chars_max_in_fixture': selected_chars,
        'automatic_recipe_char_cap': 2400,
        'specialist_output_token_cap': {'before': 1024, 'after': 768},
        'fresh_greeting_output_token_cap': {'before': 2048, 'after': 256},
        'specialist_call_cap': 3, 'parallel_call_cap': 2,
        'limits': 'Caps are ceilings, not measured billed-token savings. Retrieval timings exclude providers, workers and browser. No live performance claim.',
    }, indent=2))


if __name__ == '__main__':
    main()
