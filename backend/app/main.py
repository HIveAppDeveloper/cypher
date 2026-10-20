from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import secrets
from sqlalchemy.schema import CreateSchema
from sqlalchemy import text, update, or_
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db.session import engine, Base
from app.api import router as api_router
from app.api.websocket import router as ws_router
from contextlib import asynccontextmanager
import logging
import asyncio
from contextlib import suppress

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB tables
    async with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            await conn.execute(text("SELECT pg_advisory_xact_lock(1763000272)"))
            await conn.execute(CreateSchema(settings.DATABASE_SCHEMA, if_not_exists=True))
        await conn.run_sync(Base.metadata.create_all)
        from app.models.bot import Bot
        await conn.execute(update(Bot).where(or_(Bot.llm_provider != 'openai', Bot.llm_model.notin_(['gpt-6.1-sol', 'gpt-6-luna']))).values(llm_provider='openai', llm_model='gpt-6.1-sol'))
    logger.info("Database tables created")

    # Initialize Redis (optional for local dev)
    try:
        import redis.asyncio as aioredis
        app.state.redis = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
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

    from app.services.worker import run_worker
    worker = asyncio.create_task(run_worker()) if settings.RUN_EMBEDDED_WORKER else None
    try:
        yield
    finally:
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker

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

@app.middleware("http")
async def authenticate_backend(request: Request, call_next):
    if settings.BACKEND_API_TOKEN and request.url.path.startswith("/api/"):
        expected = "Bearer " + settings.BACKEND_API_TOKEN
        if not secrets.compare_digest(request.headers.get("authorization", ""), expected):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    from vercel.headers import HeadersContext
    with HeadersContext(dict(request.headers)).use():
        return await call_next(request)

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
