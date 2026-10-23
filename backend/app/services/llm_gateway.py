import os
import logging
import asyncio
import litellm
from app.config import settings
from app.services.model_routing import (
    ModelConfigurationError, ModelNotConfiguredError, ModelCapabilityError, validate_capabilities, retryable,
)

logger = logging.getLogger(__name__)

def model_selection(model=None, provider=None, *, specialist=False):
    provider = settings.LLM_PROVIDER if provider is None else provider
    model = settings.LLM_MODEL if model is None else model
    if not isinstance(model, str) or not model.strip() or not isinstance(provider, str) or not provider.strip():
        raise ModelConfigurationError("Set a provider and a non-empty model ID before sending a message.")
    provider, model = provider.strip(), model.strip()
    provider = 'xai' if provider == 'spacexai' else provider
    from app.services.model_profiles import ALLOWED_MODELS
    if (provider, model) not in ALLOWED_MODELS:
        raise ModelConfigurationError("Choose a configured task model in conversation settings. Model IDs are checked against the live catalog before use.")
    if provider == 'auto':
        from app.services import omniroute
        if not omniroute.enabled():
            raise ModelConfigurationError("OmniRoute cloud models require the cloud OmniRoute connection. Choose a direct provider model or connect OmniRoute.")
    return provider, model

def completion_options(model=None, provider=None, *, specialist=False, direct=False, api_key_override=None):
    provider, model = model_selection(model, provider, specialist=specialist)
    from app.services import omniroute
    if provider == 'auto' and direct:
        raise ModelConfigurationError("OmniRoute cloud models cannot be used for a direct provider check. Select a direct provider model.")
    if omniroute.enabled() and not direct:
        return {'model': 'openai/' + omniroute.model_id(provider, model), 'api_base': omniroute.endpoint(), 'api_key': settings.OMNIROUTE_API_KEY,
                'extra_headers': {k:v for k,v in omniroute.headers().items() if k != 'Authorization'}}
    if not model.startswith(provider + "/"):
        model = f"{provider}/{model}"
    key_name = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}.get(provider, provider.upper() + "_API_KEY")
    key = api_key_override or (settings.LLM_API_KEY if not direct else "") or os.getenv("HIVE_" + key_name) or os.getenv("ATLAS_" + key_name) or os.getenv(key_name)
    if not key:
        raise ModelNotConfiguredError("The selected provider route is not configured. Its declared fallback can be used if available.")
    if provider == "openai" and model.removeprefix("openai/").startswith("gpt-6"):
        model = "openai/responses/" + model.removeprefix("openai/")
    options = {"model": model}
    if key:
        options["api_key"] = key
    if settings.LLM_API_BASE and not direct:
        from urllib.parse import urlsplit
        if urlsplit(settings.LLM_API_BASE).hostname == "ai-gateway.vercel.sh":
            raise ModelConfigurationError("Vercel AI Gateway is disabled. Configure OmniRoute or a direct provider connection.")
        options["api_base"] = settings.LLM_API_BASE
    if direct:
        # Pin official endpoints as well as the model provider. Ambient SDK
        # API_BASE variables must not silently introduce an undisclosed router.
        options["api_base"] = {
            "openai": "https://api.openai.com/v1",
            "anthropic": "https://api.anthropic.com",
            "deepseek": "https://api.deepseek.com",
            "gemini": "https://generativelanguage.googleapis.com/" + ("v1alpha" if model.removeprefix("gemini/").startswith("gemini-3") else "v1beta"),
            "xai": "https://api.x.ai/v1",
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
    return kwargs

class LLMGateway:
    @staticmethod
    async def complete(messages, tools=None, model=None, provider=None, options=None, fallback=None, allow_fallback=True, **run_options):
        from app.services import omniroute
        from app.services.usage import check_allowance,record
        await check_allowance()
        await omniroute.refresh_model_routes()
        provider, model = model_selection(model, provider)
        routes = [(provider, model)]
        from app.services.model_profiles import included_routing, INCLUDED_PROFILES, FREE_ROUTES
        included_backups = {(p.provider,p.model) for p in INCLUDED_PROFILES.values()} | {p.fallback for p in INCLUDED_PROFILES.values()} | {tuple(public.split('/',1)) for public in FREE_ROUTES}
        def add_route(candidate):
            try:
                selected = model_selection(candidate[1], candidate[0])
            except (TypeError, IndexError):
                return
            if included_routing() and selected not in included_backups:
                return
            if selected not in routes:
                routes.append(selected)
        declared = []
        if fallback:
            if isinstance(fallback, tuple) and len(fallback) == 2 and all(isinstance(part, str) for part in fallback):
                declared = [fallback]
            else:
                declared = list(fallback)
        if allow_fallback:
            # Gemini and Grok are reciprocal backups when one account runs out
            # of API quota. Task-specific backups follow those first choices.
            if provider == 'gemini' and not included_routing():
                add_route(('xai', 'grok-4.7'))
            elif provider == 'xai' and not included_routing():
                add_route(('gemini', 'gemini-3.8-flash'))
            for candidate in declared:
                add_route(candidate)
        if allow_fallback and settings.LLM_FALLBACK_MODEL is not None:
            add_route((settings.LLM_FALLBACK_PROVIDER or provider, settings.LLM_FALLBACK_MODEL))
        if allow_fallback and not included_routing():
            for candidate in (('gemini', 'gemini-3.8-flash'), ('xai', 'grok-4.7')):
                add_route(candidate)
        last_error = None
        for index, (route_provider, route_model) in enumerate(routes):
            try:
                managed_key = omniroute.managed_api_key(route_provider) if route_provider in {'gemini', 'xai'} else None
                direct_managed = bool(managed_key)
                connection = completion_options(route_model, route_provider, direct=direct_managed, api_key_override=managed_key)
                if direct_managed:
                    from app.services.model_routing import validate_direct_capabilities
                    await validate_direct_capabilities(messages, tools, route_provider, route_model)
                else:
                    await validate_capabilities(messages, tools, route_provider, route_model)
            except (ModelConfigurationError, ModelCapabilityError) as error:
                # Missing route configuration or an unsupported capability may
                # select a declared backup. Invalid selections and catalog
                # outages still stop before any model request.
                if isinstance(error, (ModelCapabilityError, ModelNotConfiguredError)) and index + 1 < len(routes):
                    last_error = last_error or error
                    continue
                if index and last_error is not None:
                    raise last_error from error
                raise
            generation = generation_options(options, route_provider, route_model) if options is not None else run_options
            try:
                # Avoid forwarding sampling controls to models that only accept
                # reasoning. Preserve the provider's supported effort levels.
                if omniroute.enabled() and not direct_managed:
                    from app.services.model_routing import route_catalog
                    from app.services.model_profiles import model_route_id
                    meta = (await route_catalog())[model_route_id(route_provider,route_model)]
                    supported = meta.get('supported_parameters', [])
                    if 'temperature' not in supported:
                        generation.pop('temperature',None)
                    efforts = next((r['values'] for r in meta.get('reasoning_options',[]) if r['type']=='effort'), [])
                    if options is not None and efforts:
                        requested = options.reasoning_effort or 'low'
                        # Reasoning levels are provider-specific; never send an
                        # unsupported level or let "medium" become maximum.
                        effort = requested if requested in efforts else ('low' if requested in {'none','low','medium'} and 'low' in efforts else 'high' if 'high' in efforts else efforts[0])
                        generation['reasoning_effort']=effort
                if omniroute.enabled() and not direct_managed:
                    response = await omniroute.complete(messages, tools, route_provider, route_model, generation)
                else:
                    response = await litellm.acompletion(messages=messages, tools=tools, **generation, **connection, num_retries=0)
                # Keep routing observable without changing the provider's result shape.
                if isinstance(getattr(response, "_hidden_params", None), dict):
                    response._hidden_params["grokbot_route"] = {"provider": route_provider, "model": route_model, "fallback": bool(index)}
                    if omniroute.enabled() and not direct_managed:
                        response._hidden_params["grokbot_route"].update(transport='omniroute', transport_model=omniroute.model_id(route_provider, route_model))
                    elif direct_managed:
                        response._hidden_params["grokbot_route"].update(transport='provider_api')
                logger.info("Model route succeeded provider=%s model=%s fallback=%s", route_provider, route_model, bool(index))
                await record(route_provider,route_model,getattr(response,'usage',None),direct=direct_managed or not omniroute.enabled())
                return response
            except Exception as error:
                last_error = error
                if index + 1 >= len(routes) or not retryable(error):
                    raise
                logger.warning("Model route unavailable provider=%s model=%s type=%s; trying another configured provider", route_provider, route_model, type(error).__name__)
        raise last_error

    @staticmethod
    async def stream(messages, tools=None, model=None, provider=None, *, direct=False, deadline=None, **run_options):
        from app.services import omniroute
        provider, model = model_selection(model, provider)
        if not direct:
            await omniroute.refresh_model_routes()
        managed_key = omniroute.managed_api_key(provider) if not direct and provider in {'gemini', 'xai'} else None
        direct_managed = bool(managed_key)
        if omniroute.enabled() and not direct and not direct_managed:
            from app.services.usage import check_allowance, record
            await check_allowance()
            await validate_capabilities(messages, tools, provider, model)
            if deadline is not None and asyncio.get_running_loop().time() >= deadline:
                raise TimeoutError()
            async for chunk in omniroute.stream(messages, tools, provider, model, run_options):
                if getattr(chunk, 'usage', None):
                    await record(provider, model, chunk.usage)
                yield chunk
            return
        connection = completion_options(model, provider, direct=direct or direct_managed, api_key_override=managed_key)
        if direct or direct_managed:
            from app.services.model_routing import validate_direct_capabilities
            await validate_direct_capabilities(messages, tools, provider, model)
        else:
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
