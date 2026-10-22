import os
import logging
import asyncio
import litellm
from app.config import settings
from app.services.model_routing import (
    ModelConfigurationError, ModelCapabilityError, validate_capabilities, retryable,
)

logger = logging.getLogger(__name__)

def model_selection(model=None, provider=None, *, specialist=False):
    provider = settings.LLM_PROVIDER if provider is None else provider
    model = settings.LLM_MODEL if model is None else model
    if not isinstance(model, str) or not model.strip() or not isinstance(provider, str) or not provider.strip():
        raise ModelConfigurationError("Set a provider and a non-empty model ID before sending a message.")
    provider, model = provider.strip(), model.strip()
    from app.services.model_profiles import ALLOWED_MODELS
    if (provider, model) not in ALLOWED_MODELS:
        raise ModelConfigurationError("Choose a configured task model in conversation settings. Model IDs are checked against the live catalog before use.")
    return provider, model

def completion_options(model=None, provider=None, *, specialist=False, direct=False):
    provider, model = model_selection(model, provider, specialist=specialist)
    if settings.LLM_USE_GATEWAY and not direct:
        gateway_provider = {"gemini": "google"}.get(provider, provider)
        model = {"claude-sonnet-4-5": "claude-sonnet-4.5"}.get(model, model)
        gateway_model = model if "/" in model else f"{gateway_provider}/{model}"
        key = os.getenv("AI_GATEWAY_API_KEY")
        if not key:
            # The legacy *_sync alias reads ambient tokens without checking expiry.
            # The expiry-aware accessor reads the daemon's rotating token file.
            from vercel.oidc import get_vercel_oidc_token, VercelOidcTokenError
            try:
                key = get_vercel_oidc_token()
            except VercelOidcTokenError:
                key = None
        if not key:
            raise ModelConfigurationError("Vercel AI Gateway credentials unavailable. Configure a valid gateway key or enable deployment OIDC, including the worker's rotating token file.")
        prefix = "openai/responses/" if provider == "openai" and model.startswith("gpt-6") else "openai/"
        return {"model": prefix + gateway_model, "api_base": "https://ai-gateway.vercel.sh/v1", "api_key": key}
    if not model.startswith(provider + "/"):
        model = f"{provider}/{model}"
    key_name = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}.get(provider, provider.upper() + "_API_KEY")
    key = (settings.LLM_API_KEY if not direct else "") or os.getenv("HIVE_" + key_name) or os.getenv("ATLAS_" + key_name) or os.getenv(key_name)
    if not key:
        raise ModelConfigurationError("The model connection needs authentication. Configure the selected provider's API key on the backend and worker.")
    if provider == "openai" and model.removeprefix("openai/").startswith("gpt-6"):
        model = "openai/responses/" + model.removeprefix("openai/")
    options = {"model": model}
    if key:
        options["api_key"] = key
    if settings.LLM_API_BASE and not direct:
        options["api_base"] = settings.LLM_API_BASE
    if direct:
        # Pin official endpoints as well as the model provider. Ambient SDK
        # API_BASE variables must not silently introduce an undisclosed router.
        options["api_base"] = {
            "openai": "https://api.openai.com/v1",
            "anthropic": "https://api.anthropic.com",
            "deepseek": "https://api.deepseek.com",
            "gemini": "https://generativelanguage.googleapis.com/" + ("v1alpha" if model.removeprefix("gemini/").startswith("gemini-3") else "v1beta"),
        }[provider]
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
    async def complete(messages, tools=None, model=None, provider=None, options=None, fallback=None, **run_options):
        from app.services.usage import check_allowance,record
        await check_allowance()
        provider, model = model_selection(model, provider)
        routes = [(provider, model)]
        if fallback and fallback not in routes:
            routes.append(model_selection(fallback[1], fallback[0]))
        if settings.LLM_FALLBACK_MODEL is not None:
            backup = model_selection(settings.LLM_FALLBACK_MODEL, settings.LLM_FALLBACK_PROVIDER or provider)
            if backup not in routes:
                routes.append(backup)
        last_error = None
        for index, (route_provider, route_model) in enumerate(routes):
            try:
                connection = completion_options(route_model, route_provider)
                await validate_capabilities(messages, tools, route_provider, route_model)
            except (ModelConfigurationError, ModelCapabilityError) as error:
                # Only capability mismatch can select an explicitly configured backup.
                if isinstance(error, ModelCapabilityError) and index + 1 < len(routes):
                    last_error = error
                    continue
                if index and last_error is not None:
                    raise last_error from error
                raise
            generation = generation_options(options, route_provider, route_model) if options is not None else run_options
            try:
                # Avoid forwarding sampling controls to models that only accept
                # reasoning. Preserve the provider's supported effort levels.
                if settings.LLM_USE_GATEWAY:
                    from app.services.model_routing import gateway_catalog
                    from app.services.model_profiles import gateway_id
                    meta = (await gateway_catalog())[gateway_id(route_provider,route_model)]
                    supported = meta.get('supported_parameters', [])
                    if 'temperature' not in supported:
                        generation.pop('temperature',None)
                    efforts = next((r['values'] for r in meta.get('reasoning_options',[]) if r['type']=='effort'), [])
                    if options is not None and efforts:
                        requested = options.reasoning_effort or 'low'
                        # Reasoning levels are provider-specific; never send an
                        # unsupported level or let "medium" become maximum.
                        effort = requested if requested in efforts else ('low' if requested in {'none','low','medium'} and 'low' in efforts else 'high' if 'high' in efforts else efforts[0])
                        if route_provider == 'openai':generation['reasoning_effort']=effort
                        else:
                            generation.pop('reasoning_effort',None)
                            generation['extra_body']={**generation.get('extra_body',{}),'reasoning':{'effort':effort}}
                response = await litellm.acompletion(messages=messages, tools=tools, **generation, **connection, num_retries=0)
                # Keep routing observable without changing the provider's result shape.
                if isinstance(getattr(response, "_hidden_params", None), dict):
                    response._hidden_params["grokbot_route"] = {"provider": route_provider, "model": route_model, "fallback": bool(index)}
                logger.info("Model route succeeded provider=%s model=%s fallback=%s", route_provider, route_model, bool(index))
                await record(route_provider,route_model,getattr(response,'usage',None))
                return response
            except Exception as error:
                last_error = error
                if index + 1 >= len(routes) or not retryable(error):
                    raise
                logger.warning("Model route unavailable provider=%s model=%s type=%s; trying configured backup", route_provider, route_model, type(error).__name__)
        raise last_error

    @staticmethod
    async def stream(messages, tools=None, model=None, provider=None, *, direct=False, deadline=None, **run_options):
        provider, model = model_selection(model, provider)
        connection = completion_options(model, provider, direct=direct)
        await validate_capabilities(messages, tools, provider, model)
        if deadline is not None and asyncio.get_running_loop().time() >= deadline:
            raise TimeoutError()
        response = await litellm.acompletion(messages=messages, tools=tools, stream=True, num_retries=0, **run_options, **connection)
        try:
            async for chunk in response:
                yield chunk
        finally:
            # A consumer may disconnect or hit its deadline between chunks.
            # Close the provider connection instead of leaving generation alive.
            close = getattr(response, "aclose", None)
            if close is not None:
                try:
                    async with asyncio.timeout(1):
                        await close()
                except TimeoutError:
                    logger.warning("Provider stream cleanup reached its deadline")
