import redis.asyncio as aioredis
from app.config import settings
import json
import logging

logger = logging.getLogger(__name__)

class MemoryManager:
    """Manages persistent memory for bots across conversations."""

    def __init__(self):
        self._redis = None

    async def _get_redis(self):
        if self._redis is None:
            try:
                self._redis = aioredis.from_url(settings.REDIS_URL)
                await self._redis.ping()
            except Exception as e:
                logger.warning(f"Redis unavailable, using in-memory fallback: {e}")
                self._redis = None
        return self._redis

    # In-memory fallback when Redis is unavailable
    _memory_store: dict[str, list] = {}

    async def store_message(
        self, bot_id: str, conversation_id: str, role: str, content: str
    ):
        message = {"role": role, "content": content}
        key = f"memory:{bot_id}:{conversation_id}"
        
        redis = await self._get_redis()
        if redis:
            try:
                await redis.rpush(key, json.dumps(message))
                await redis.ltrim(key, -100, -1)
                return
            except Exception:
                pass
        
        # Fallback to in-memory
        if key not in self._memory_store:
            self._memory_store[key] = []
        self._memory_store[key].append(message)
        self._memory_store[key] = self._memory_store[key][-100:]

    async def get_context(
        self, bot_id: str, conversation_id: str = ""
    ) -> list[dict]:
        key = f"memory:{bot_id}:{conversation_id}"
        
        redis = await self._get_redis()
        if redis:
            try:
                messages = await redis.lrange(key, 0, -1)
                return [json.loads(m) for m in messages]
            except Exception:
                pass
        
        return list(self._memory_store.get(key, []))

    async def clear_context(self, bot_id: str, conversation_id: str = ""):
        key = f"memory:{bot_id}:{conversation_id}"
        
        redis = await self._get_redis()
        if redis:
            try:
                await redis.delete(key)
            except Exception:
                pass
        
        self._memory_store.pop(key, None)
