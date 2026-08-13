FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    chromium-browser \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright and browsers globally
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/lib/playwright
RUN npm install -g playwright && \
    npx playwright install --with-deps chromium

# Create non-root user 'bot'
RUN useradd -m -s /bin/bash bot

# Set up working directory
WORKDIR /workspace
RUN mkdir -p /workspace/data /workspace/downloads && \
    chown -R bot:bot /workspace

# Switch to bot user
USER bot

# Set entrypoint to keep container alive
CMD ["sleep", "infinity"]
