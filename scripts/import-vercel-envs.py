#!/usr/bin/env python3
"""Import Hive + Atlas exports under namespaces. Never prints secret values.
Run `vercel env pull` in separate linked folders and provide the resulting files.
Production/Preview Secret values can be omitted by Vercel; the report names missing
keys and never claims those values were copied. Add them on the private host.
"""
import argparse
import json
import os
from pathlib import Path
from dotenv import dotenv_values

parser = argparse.ArgumentParser()
parser.add_argument("--hive", type=Path, required=True)
parser.add_argument("--atlas", type=Path, required=True)
parser.add_argument("--output", type=Path, default=Path(".env.vercel.local"))
args = parser.parse_args()
values = {}
for prefix, source in (("HIVE", args.hive), ("ATLAS", args.atlas)):
    env = dotenv_values(source, interpolate=False)
    values.update({prefix + "_" + key: value for key, value in env.items() if value is not None and not key.startswith("VERCEL_")})
# Keep both sets; do not silently overwrite duplicate unprefixed keys.
lines = [key + "=" + "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'" for key, value in sorted(values.items())]
args.output.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.chmod(args.output, 0o600)
with os.fdopen(fd, "w") as out:
    out.write("\n".join(lines) + "\n")
print(f"Imported {len(values)} namespaced variables. No values printed.")
if not (values.get("HIVE_DATABASE_URL") or values.get("HIVE_POSTGRES_URL")):
    print("Missing: HIVE_DATABASE_URL (native Postgres connection)")
if not (values.get("HIVE_GEMINI_API_KEY") or values.get("ATLAS_GEMINI_API_KEY")):
    print("Missing: Gemini API key; supply LLM_API_KEY privately or configure another provider.")
