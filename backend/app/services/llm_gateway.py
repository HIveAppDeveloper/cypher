import os
import litellm
from app.config import settings

def completion_options(model=None, provider=None):
    provider = provider or settings.LLM_PROVIDER
    model = model or settings.LLM_MODEL
    if not model.startswith(provider + "/"):
        model = f"{provider}/{model}"
    key_name = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}.get(provider, provider.upper() + "_API_KEY")
    key = settings.LLM_API_KEY or os.getenv("HIVE_" + key_name) or os.getenv("ATLAS_" + key_name) or os.getenv(key_name)
    options = {"model": model}
    if key:
        options["api_key"] = key
    if settings.LLM_API_BASE:
        options["api_base"] = settings.LLM_API_BASE
    return options

class LLMGateway:
    @staticmethod
    async def complete(messages, tools=None, model=None, provider=None):
        return await litellm.acompletion(messages=messages, tools=tools, **completion_options(model, provider))

    @staticmethod
    async def stream(messages, tools=None, model=None, provider=None):
        response = await litellm.acompletion(messages=messages, tools=tools, stream=True, **completion_options(model, provider))
        async for chunk in response:
            yield chunk
