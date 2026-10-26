FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 KOKORO_MODEL_DIR=/opt/models
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 espeak-ng && rm -rf /var/lib/apt/lists/*
COPY requirements.txt requirements.lock.txt ./
RUN pip install --no-cache-dir -r requirements.lock.txt
COPY download_models.py .
RUN python download_models.py
COPY kokoro_service.py .
COPY licenses /usr/share/doc/cypher-kokoro
EXPOSE 80
CMD ["sh", "-c", "exec uvicorn kokoro_service:app --host 0.0.0.0 --port ${PORT:-80} --workers 1 --no-access-log"]
