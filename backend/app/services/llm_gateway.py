import litellm
from app.config import settings

class LLMGateway:
    @staticmethod
    async def complete(messages, tools=None, model=None, provider=None):
        mdl = model or settings.LLM_MODEL
        if provider:
            mdl = f"{provider}/{mdl}"
        
        response = await litellm.acompletion(
            model=mdl,
            messages=messages,
            tools=tools,
            api_key=settings.LLM_API_KEY
        )
        return response

    @staticmethod
    async def stream(messages, tools=None, model=None, provider=None):
        mdl = model or settings.LLM_MODEL
        if provider:
            mdl = f"{provider}/{mdl}"
            
        response = await litellm.acompletion(
            model=mdl,
            messages=messages,
            tools=tools,
            stream=True,
            api_key=settings.LLM_API_KEY
        )
        async for chunk in response:
            yield chunk
