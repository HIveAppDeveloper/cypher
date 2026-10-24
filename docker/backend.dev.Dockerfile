# Base44 development image for the FastAPI backend.
# Installs dependencies only; application source is bind-mounted at runtime so
# edits are picked up by uvicorn --reload without rebuilding.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LITELLM_LOCAL_MODEL_COST_MAP=True

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/pyproject.toml ./
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN python -c "import tomllib; from pathlib import Path; Path('/tmp/requirements.txt').write_text('\n'.join(tomllib.loads(Path('pyproject.toml').read_text())['project']['dependencies']))" \
    && pip install --no-cache-dir -r /tmp/requirements.txt

EXPOSE 8000
