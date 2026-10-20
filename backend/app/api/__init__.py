from fastapi import APIRouter
from .bots import router as bots_router
from .conversations import router as conversations_router
from .messages import router as messages_router

from .plugins import router as plugins_router

from .teams import router as teams_router

from .runtime import router as runtime_router

from .automation import router as automation_router

router = APIRouter()
router.include_router(automation_router,tags=["automation"])
router.include_router(runtime_router, prefix="/runtime", tags=["runtime"])
router.include_router(teams_router, prefix="/teams", tags=["teams"])
router.include_router(plugins_router, prefix="/plugins", tags=["plugins"])
router.include_router(bots_router, prefix="/bots", tags=["bots"])
router.include_router(conversations_router, prefix="/conversations", tags=["conversations"])
router.include_router(messages_router, prefix="/conversations", tags=["messages"])
