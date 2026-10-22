"""Validate input capabilities before inference; never turn images into text-only requests."""
from app.config import settings


class ModelConfigurationError(ValueError):
    pass


class ModelNotConfiguredError(ModelConfigurationError):
    """The selected route has no credential; a declared backup may run."""


class ModelCapabilityError(ValueError):
    pass


async def route_catalog():
    from app.services import omniroute
    if not omniroute.enabled():
        raise ModelConfigurationError("Configure an OmniRoute connection to check its live model catalog.")
    try:
        return await omniroute.catalog()
    except Exception as error:
        raise ModelConfigurationError("Model availability could not be checked. Try again when the OmniRoute model catalog is reachable.") from error


def required_modalities(messages):
    required = {"text"}
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            kind = part.get("type")
            if kind in {"image_url", "input_image"}:
                required.add("image")
            elif kind in {"file", "input_file"}:
                required.add("pdf")
            elif kind in {"input_audio", "audio"}:
                required.add("audio")
            elif kind in {'video_url','input_video'}:
                required.add('video')
    return required


async def validate_direct_capabilities(messages, tools, provider, model):
    await validate_capabilities(messages, tools, provider, model, direct=True)


async def validate_capabilities(messages, tools, provider, model, *, direct=False):
    required = required_modalities(messages)
    from app.services import omniroute
    if not direct and omniroute.enabled():
        from app.services.model_profiles import model_route_id
        item = (await route_catalog()).get(model_route_id(provider,model))
        if item is None or item.get("type") != "language":
            raise ModelCapabilityError("The selected model is unavailable on the configured model connection. Choose an available chat model in conversation settings.")
        supported = set(item.get("modalities", {}).get("input", []))
        supports_tools = "tools" in item.get("supported_parameters", [])
    else:
        from litellm.utils import supports_vision, supports_pdf_input, supports_audio_input, supports_function_calling
        name = f"{provider}/{model}"
        supported = {"text"}
        for mode, check in (("image", supports_vision), ("pdf", supports_pdf_input), ("audio", supports_audio_input)):
            if check(name):
                supported.add(mode)
        supports_tools = supports_function_calling(name)
    missing = required - supported
    if missing:
        label = ", ".join(sorted(missing))
        raise ModelCapabilityError(f"The selected model cannot read this request's {label} input. Choose a model that supports these files, or remove them and send a text-only request. The files were kept; no input was discarded.")
    if tools and not supports_tools:
        raise ModelCapabilityError("The selected model does not support tool calls. Choose a model with tool support before running this agent.")


def retryable(error):
    # Quota exhaustion is account-specific: hand the task to another configured
    # provider. Authentication and policy failures remain hard stops.
    status = getattr(error, "status_code", None)
    reason = str(error).lower()
    quota = any(term in reason for term in ("quota", "credit", "budget", "exhausted", "insufficient_quota"))
    if quota:
        return True
    if status in {401, 403}:
        return False
    if any(term in reason for term in ("authentication", "permission", "unauthorized", "forbidden")):
        return False
    return status in {402, 404, 408, 429, 500, 502, 503, 504} or type(error).__name__ in {"Timeout", "APITimeoutError", "APIConnectionError", "ServiceUnavailableError", "NotFoundError", "RateLimitError"}


def public_model_error(error):
    """Actionable messages contain no raw provider body, credential or endpoint."""
    if isinstance(error, (ModelConfigurationError, ModelCapabilityError)) or type(error).__name__=='UsageLimitError':
        return str(error)
    status = getattr(error, "status_code", None)
    kind, reason = type(error).__name__.lower(), str(error).lower()
    if status == 413:
        return "This request exceeds the model connection's size limit. Your original message and files are saved. Send fewer or smaller files, or start a new conversation to reduce attachment history."
    if status == 401 or "authentication" in kind or "authentication" in reason:
        if settings.OMNIROUTE_URL:
            return "The OmniRoute connection could not authenticate. Check its inference key and deployment access. Your message and files are saved."
        return "The model provider connection could not authenticate. Check the configured provider key on the backend and worker. Your message and files are saved; no model result was produced."
    if status == 402 or any(word in reason for word in ("credit", "quota", "budget", "restrictedmodelserror", "free tier users")):
        return "The model provider reports a credit, quota, or budget limit. Review the provider account before retrying. Your message and files are saved."
    if status == 403:
        return "The provider denied access to this model. Check model permissions or choose an available model. Your message and files are saved."
    if status == 404 or "notfound" in kind:
        return "The provider could not find the selected model. Check the model ID and its availability, then retry. Your message and files are saved."
    if status == 429:
        return "The model provider is busy or rate limited. Wait briefly and retry. Your message and files are saved."
    if retryable(error):
        return "The model connection is temporarily unavailable. Try again shortly. Your message and files are saved."
    if status == 400 or "badrequest" in kind:
        return "The provider rejected this request's inputs or model settings. Check the selected model's file support and conversation settings. Your message and files are saved."
    return "The model request failed. Your message and files are saved. Try again, or check the private server logs using the error reference below."
