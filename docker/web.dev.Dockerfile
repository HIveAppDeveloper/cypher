# Base44 development image for the Next.js frontend.
# Installs node_modules from the lockfile; the source is bind-mounted at runtime
# and served by `next dev`, so edits hot-reload without rebuilding.
FROM node:22-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

EXPOSE 3000
