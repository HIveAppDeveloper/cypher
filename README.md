# Cypher · VentureCruiter

Cypher's agent workspace, conversations, voice, connected tools, and prospecting application. The existing `lead-funnel/` command-line project is preserved.

## Run locally

```sh
cd frontend
npm ci
npm run dev
```

The UI starts on port 3000. Connect the API with server-only `BACKEND_INTERNAL_URL` or use the full Docker stack documented below. Without a backend the UI displays connection recovery and `/api/health` returns HTTP 503.

## Deploy on Vercel

Import **sodikjonismoilov/VentureCruiter**, choose the repository root, and retain the root `vercel.json`. It defines the Next.js frontend, a private Python backend through a service binding, and the persistent agent worker. This requires Vercel Services and Daemons access. Keep credentials in Vercel environment settings.

For the existing Hive Cypher project, use its existing environment and database configuration. For a separate installation, configure PostgreSQL, `GROKBOT_BACKEND_API_TOKEN` / backend `BACKEND_API_TOKEN`, authentication (`REQUIRE_USER_AUTH=true`, `AUTH_SESSION_SECRET`), and model credentials before making it public; see `.env.example` and `deployment/`. Google sign-in and connected providers also require the new hostname in their registered callback URLs. The current canonical sign-in hostname is `cypher-agent.vercel.app` in `frontend/src/lib/canonical-app.ts`; change it when creating a separately hosted installation.

### HTTP endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Public readiness probe; 200 when the backend health probe succeeds, otherwise 503. Returns no credentials or internal addresses. |
| `GET /api/runtime` | Authenticated runtime, model and worker capability information. |
| `/api/*` | Same-origin API proxy to the private backend, retaining existing session and service authorization. |
| `/` | Agent workspace. |
| `/prospecting` | Company discovery and prospect research. |

Readiness confirms HTTP reachability, not model/provider access or worker execution. Use `/api/runtime` and a real task for those checks.

## Validation

```sh
cd frontend
node --test tests/*.test.mjs
npm run build
```

---

# 🤖 Open GrokBot

> **Your personal team of AI agents that work 24/7 — self-hosted, open-source, and free.**

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Stars](https://img.shields.io/github/stars/ishandutta2007/open-grokbot?style=social)
![Docker Pulls](https://img.shields.io/docker/pulls/ishandutta2007/open-grokbot)

## What is Open GrokBot?

Open GrokBot is an open-source, self-hosted alternative to x.ai's Grok Bot. It is a platform that gives you an always-on AI agent, ready to perform tasks for you 24/7. It provides a multi-agent environment where agents can collaborate, learn from your demonstrations, and complete end-to-end tasks in isolated sandbox environments.

## Feature Comparison

| Feature | Open GrokBot | Grok Bot (x.ai) |
| :--- | :--- | :--- |
| **Pricing** | Free (Bring your own API key / Local LLM) | Subscription |
| **Hosting** | Self-Hosted / Private Cloud | Cloud (SaaS) |
| **Data Privacy** | 100% Local / Private | Shared with Provider |
| **Custom Agents** | Yes, full autonomy | Limited |
| **Sandbox Execution**| Yes (Docker-in-Docker) | Yes |

## ✨ Key Features

1. 🖥️ **Always-On Cloud PC**: Your agents live in persistent environments, constantly working on tasks in the background.
2. 🌐 **No-API UI Operation**: Agents can interact with graphical user interfaces using Playwright and headless browsers.
3. 🤝 **Autonomous Multi-Agent Group Chats**: Agents can collaborate in groups to solve complex multi-step problems.
4. 🎓 **Demonstration-Based Learning**: Teach your agents how to perform tasks by showing them, and they'll remember for next time.
5. ✅ **End-to-End Task Completion**: From research to execution to reporting, agents handle the full lifecycle.

## 🚀 Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/ishandutta2007/open-grokbot.git
   cd open-grokbot
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your preferred LLM API keys and secrets
   ```

3. **Start the platform**
   ```bash
   make up
   # Or using docker compose directly: docker compose up -d
   ```

4. **Access the UI**
   Open your browser and navigate to `http://localhost:3000`.

## 🏗️ Architecture

```mermaid
graph TD
    User([User]) --> Frontend[Next.js Frontend\nPort 3000]
    Frontend --> Backend[FastAPI Backend\nPort 8000]
    
    Backend --> DB[(PostgreSQL 16\nState & Metadata)]
    Backend --> Cache[(Redis 7\nPub/Sub & Task Queue)]
    Backend --> Storage[(MinIO\nFile & Artifact Storage)]
    
    Backend --> DockerDaemon[Docker Daemon\nContainer Management]
    DockerDaemon --> Sandbox1[Sandbox 1\nUbuntu Workspace]
    DockerDaemon --> Sandbox2[Sandbox 2\nUbuntu Workspace]
```

## 🛠️ Tech Stack

| Component | Technology |
| :--- | :--- |
| **Frontend** | Next.js, React, Vanilla CSS |
| **Backend** | Python, FastAPI, SQLAlchemy |
| **Database** | PostgreSQL 16 |
| **Cache / Queue** | Redis 7 |
| **Storage** | MinIO (S3 Compatible) |
| **Sandbox** | Docker, Ubuntu 24.04, Playwright |

## ⚙️ Configuration

Configuration is managed via the `.env` file. See `.env.example` for all available options, including database credentials, LLM provider settings (OpenAI, Anthropic, Ollama, etc.), and application secrets.

## 📚 API Documentation

Once the backend is running, you can view the interactive API documentation at `http://localhost:8000/docs` (Swagger UI) or `http://localhost:8000/redoc`.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to set up the development environment, run tests, and submit pull requests.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
⭐️ **If you find this project useful, please consider giving it a star!**
