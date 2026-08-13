from fastapi import APIRouter
from .bots import router as bots_router
from .conversations import router as conversations_router
from .messages import router as messages_router

router = APIRouter()
router.include_router(bots_router, prefix="/bots", tags=["bots"])
router.include_router(conversations_router, prefix="/conversations", tags=["conversations"])
router.include_router(messages_router, prefix="/conversations", tags=["messages"])
