from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import secrets
import re
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db.session import engine
from app.db.tenancy import current_tenant_id
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
    from app.services.database_health import initialize, recover
    await initialize(app, engine)
    recovery = asyncio.create_task(recover(app, engine))

    # Redis is optional in hosted mode: tasks, history, and saved context use SQL.
    app.state.redis = None
    if settings.REDIS_URL:
        import redis.asyncio as aioredis
        cache = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
        try:
            await cache.ping()
            app.state.redis = cache
            logger.info("Redis connected")
        except Exception as e:
            await cache.aclose()
            logger.warning(f"Optional Redis cache unavailable: {e}")

    app.state.docker_client = None
    if settings.SANDBOX_BACKEND == "docker":
        try:
            import docker
            app.state.docker_client = docker.from_env()
            logger.info("Docker connected")
        except Exception as e:
            logger.warning(f"Docker sandbox unavailable: {e}")

    from app.services.worker import run_worker
    worker = asyncio.create_task(run_worker()) if settings.RUN_EMBEDDED_WORKER else None
    from app.services.atlas_admission import run_admission_janitor
    admission_janitor = asyncio.create_task(run_admission_janitor()) if settings.GROKBOT_ATLAS_ENGINE_ENABLED and settings.GROKBOT_ATLAS_ENGINE_ADMISSION == "postgres" else None
    try:
        yield
    finally:
        if admission_janitor:
            admission_janitor.cancel()
            with suppress(asyncio.CancelledError):
                await admission_janitor
        recovery.cancel()
        with suppress(asyncio.CancelledError):
            await recovery
        if worker:
            worker.cancel()
            with suppress(asyncio.CancelledError):
                await worker

    # Cleanup
    if hasattr(app.state, 'redis') and app.state.redis:
        await app.state.redis.aclose()
    await engine.dispose()

app = FastAPI(
    title="Open GrokBot API",
    description="Open-source, self-hosted AI agent platform — an alternative to Grok Bot (x.ai/bot)",
    version="0.1.0",
    lifespan=lifespan,
)

@app.middleware("http")
async def authenticate_backend(request: Request, call_next):
    # This exact, stateless endpoint authenticates its raw body with a scoped
    # Atlas HMAC. It ignores browser identity and only uses hash admission
    # metadata, never workspace conversation/user data. Other gates are intact.
    if request.method == "POST" and request.url.path == "/api/integrations/atlas/v1/chat":
        return await call_next(request)
    api_request = request.url.path.startswith("/api/")
    public_auth_path = request.url.path in {"/api/auth/email/request", "/api/auth/email/verify", "/api/auth/google/verify"}
    public_auth_path = public_auth_path or (request.method=='GET' and re.fullmatch(r'/api/workspace/templates/shared/[A-Za-z0-9_-]{24,64}',request.url.path) is not None)
    public_auth_path = public_auth_path or (request.method=='POST' and request.url.path in {'/api/local-device/claim','/api/local-device/poll','/api/local-device/complete'})
    channel_ingress = request.method == "POST" and re.fullmatch(r"/api/channels/[0-9a-fA-F-]{36}/events", request.url.path) is not None
    if settings.BACKEND_API_TOKEN and api_request:
        expected = "Bearer " + settings.BACKEND_API_TOKEN
        if not secrets.compare_digest(request.headers.get("authorization", ""), expected):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    user_id = request.headers.get("x-grokbot-user-id") if api_request else None
    if settings.REQUIRE_USER_AUTH and api_request and not user_id and not public_auth_path and not channel_ingress:
        return JSONResponse({"detail": "Sign in to continue."}, status_code=401)
    request.state.user_id = user_id
    if api_request and getattr(app.state, 'database_ready', True) is False:
        detail = app.state.database_failure
        return JSONResponse(detail, status_code=503, headers={'Retry-After':str(detail['retry_after'])})
    tenant_token = current_tenant_id.set(user_id)
    from vercel.headers import HeadersContext
    try:
        with HeadersContext(dict(request.headers)).use():
            return await call_next(request)
    finally:
        current_tenant_id.reset(tenant_token)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from sqlalchemy.exc import SQLAlchemyError

@app.exception_handler(SQLAlchemyError)
async def database_error(request: Request, error):
    from app.services.database_health import failure_detail
    detail = failure_detail(error)
    app.state.database_ready = False
    app.state.database_failure = detail
    logger.error('Database request failed code=%s type=%s', detail['code'], type(error).__name__)
    return JSONResponse(detail, status_code=503, headers={'Retry-After':str(detail['retry_after'])})

app.include_router(api_router, prefix="/api")
app.include_router(ws_router)

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
