FROM node:22-bookworm-slim AS javascript
FROM python:3.12-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends     build-essential     curl     && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
RUN python -c "import tomllib; from pathlib import Path; Path('/tmp/requirements.txt').write_text('\\n'.join(tomllib.loads(Path('pyproject.toml').read_text())['project']['dependencies']))"
RUN python -m venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN python -m pip install --no-cache-dir -r /tmp/requirements.txt

FROM python:3.12-slim

WORKDIR /app
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
COPY --from=builder /opt/venv /opt/venv
COPY --from=javascript /usr/local/bin/node /usr/local/bin/node

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

RUN playwright install --with-deps chromium

COPY . .

ENV LITELLM_LOCAL_MODEL_COST_MAP=True
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
