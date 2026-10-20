import os
import litellm
from app.config import settings

def completion_options(model=None, provider=None, *, specialist=False):
    provider = provider or settings.LLM_PROVIDER
    model = model or settings.LLM_MODEL
    allowed_specialist = specialist and settings.LLM_USE_GATEWAY and (provider, model) in {("gemini", "gemini-3.5-flash"), ("anthropic", "claude-sonnet-4.6"), ("deepseek", "deepseek-v3.2")}
    if not allowed_specialist and (provider != "openai" or model not in {"gpt-6.1-sol", "gpt-6-luna"}):
        raise ValueError("Model policy allows only OpenAI GPT-6.1 Sol and GPT-6 Luna.")
    if settings.LLM_USE_GATEWAY:
        gateway_provider = {"gemini": "google"}.get(provider, provider)
        model = {"claude-sonnet-4-5": "claude-sonnet-4.5"}.get(model, model)
        gateway_model = model if "/" in model else f"{gateway_provider}/{model}"
        key = os.getenv("AI_GATEWAY_API_KEY")
        if not key:
            from vercel.oidc import get_vercel_oidc_token_sync, VercelOidcTokenError
            try:
                key = get_vercel_oidc_token_sync()
            except VercelOidcTokenError:
                key = None
        if not key:
            raise RuntimeError("Vercel AI Gateway credentials unavailable")
        prefix = "openai/responses/" if provider == "openai" and model.startswith("gpt-6") else "openai/"
        return {"model": prefix + gateway_model, "api_base": "https://ai-gateway.vercel.sh/v1", "api_key": key}
    if not model.startswith(provider + "/"):
        model = f"{provider}/{model}"
    key_name = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}.get(provider, provider.upper() + "_API_KEY")
    key = settings.LLM_API_KEY or os.getenv("HIVE_" + key_name) or os.getenv("ATLAS_" + key_name) or os.getenv(key_name)
    if provider == "openai" and model.removeprefix("openai/").startswith("gpt-6"):
        model = "openai/responses/" + model.removeprefix("openai/")
    options = {"model": model}
    if key:
        options["api_key"] = key
    if settings.LLM_API_BASE:
        options["api_base"] = settings.LLM_API_BASE
    return options

def generation_options(options, provider, model):
    """Only forward settings supported by the selected provider/model."""
    kwargs = {"max_tokens": options.max_tokens}
    reasoning = options.reasoning_effort
    is_gpt5 = provider == "openai" and model.removeprefix("openai/").startswith(("gpt-5", "gpt-6"))
    if is_gpt5:
        reasoning = reasoning or ("medium" if model.removeprefix("openai/").startswith("gpt-6") else "none")
        if model.removeprefix("openai/").startswith(("gpt-6.1-sol", "gpt-6-astra")) and reasoning == "none":
            reasoning = "low"
        kwargs["reasoning_effort"] = reasoning
    if not is_gpt5 or reasoning == "none":
        kwargs["temperature"] = options.temperature
    if provider == "openai" and options.service_tier:
        if settings.LLM_USE_GATEWAY and options.service_tier != "default":
            kwargs["extra_body"] = {"providerOptions": {"gateway": {"serviceTier": options.service_tier}}}
        elif not settings.LLM_USE_GATEWAY:
            kwargs["service_tier"] = options.service_tier
    return kwargs

class LLMGateway:
    @staticmethod
    async def complete(messages, tools=None, model=None, provider=None, **run_options):
        return await litellm.acompletion(messages=messages, tools=tools, **run_options, **completion_options(model, provider))

    @staticmethod
    async def stream(messages, tools=None, model=None, provider=None):
        response = await litellm.acompletion(messages=messages, tools=tools, stream=True, **completion_options(model, provider))
        async for chunk in response:
            yield chunk
