from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db.session import engine, Base
from app.api import router as api_router
from app.api.websocket import router as ws_router
from contextlib import asynccontextmanager
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")

    # Initialize Redis (optional for local dev)
    try:
        import redis.asyncio as aioredis
        app.state.redis = aioredis.from_url(settings.REDIS_URL)
        await app.state.redis.ping()
        logger.info("Redis connected")
    except Exception as e:
        logger.warning(f"Redis unavailable (non-critical for local dev): {e}")
        app.state.redis = None

    # Initialize Docker (optional for local dev)
    try:
        import docker
        app.state.docker_client = docker.from_env()
        logger.info("Docker connected")
    except Exception as e:
        logger.warning(f"Docker unavailable (sandbox features disabled): {e}")
        app.state.docker_client = None

    yield

    # Cleanup
    if hasattr(app.state, 'redis') and app.state.redis:
        await app.state.redis.close()
    await engine.dispose()

app = FastAPI(
    title="Open GrokBot API",
    description="Open-source, self-hosted AI agent platform — an alternative to Grok Bot (x.ai/bot)",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")
app.include_router(ws_router)

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
