"""Reviewed task routes; OmniRoute checks mapped IDs against its live catalog."""
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    provider: str
    model: str
    fallback: tuple[str, str]


PROFILES = {
    'general': Profile('openai', 'gpt-6.1-sol', ('openai', 'gpt-6-luna')),
    'planning': Profile('openai', 'gpt-6-astra', ('openai', 'gpt-6.1-sol')),
    'coding': Profile('anthropic', 'claude-sonnet-5.5', ('openai', 'gpt-6.1-sol')),
    'research': Profile('gemini', 'gemini-3.8-flash', ('openai', 'gpt-6.1-sol')),
    'writing': Profile('anthropic', 'claude-sonnet-5.5', ('openai', 'gpt-6.1-sol')),
    'analysis': Profile('deepseek', 'deepseek-v4.1-flash', ('openai', 'gpt-6.1-sol')),
    'review': Profile('xai', 'grok-4.5', ('openai', 'gpt-6.1-sol')),
    'execution': Profile('openai', 'gpt-6-luna', ('openai', 'gpt-6.1-sol')),
    'vision': Profile('gemini', 'gemini-3.8-flash', ('openai', 'gpt-6.1-sol')),
}
LEGACY_SPECIALISTS = {('gemini','gemini-3.5-flash'), ('anthropic','claude-sonnet-4.6'), ('deepseek','deepseek-v3.2')}
OMNIROUTE_AUTO_MODELS = {'best-coding', 'best-reasoning', 'best-vision', 'best-fast', 'best-chat'}
INCLUDED_PROFILES = {
    **PROFILES,
    'coding': Profile('openai', 'gpt-6.1-sol', ('openai', 'gpt-6-luna')),
    'research': Profile('deepseek', 'deepseek-v4-flash', ('openai', 'gpt-6.1-sol')),
    'writing': Profile('anthropic', 'claude-haiku-4.5', ('openai', 'gpt-6.1-sol')),
    'analysis': Profile('openai', 'gpt-6-astra', ('openai', 'gpt-6.1-sol')),
    'review': Profile('openai', 'gpt-6.1-sol', ('openai', 'gpt-6-luna')),
    'vision': Profile('openai', 'gpt-6.1-sol', ('openai', 'gpt-6-luna')),
}
FREE_ROUTES = {
    "auto/free-cf-zai-org-glm-5-2": "cfp/zai-org/glm-5.2",
    "auto/free-cf-moonshotai-kimi-k2-7-code": "cfp/moonshotai/kimi-k2.7-code",
    "auto/free-cf-moonshotai-kimi-k2-6": "cfp/moonshotai/kimi-k2.6",
    "auto/free-cf-deepseek-ai-deepseek-v4-pro-0813": "cfp/deepseek-ai/deepseek-v4-pro-0813",
    "auto/free-cf-deepseek-ai-deepseek-v4-flash-0731": "cfp/deepseek-ai/deepseek-v4-flash-0731",
    "auto/free-cf-zai-org-glm-4-7-flash": "cfp/zai-org/glm-4.7-flash",
    "auto/free-cf-openai-gpt-oss-120b": "cfp/openai/gpt-oss-120b",
    "auto/free-cf-openai-gpt-oss-20b": "cfp/openai/gpt-oss-20b",
    "auto/free-cf-meta-llama-llama-3-3-70b-instruct-fp8-fast": "cfp/meta-llama/llama-3.3-70b-instruct-fp8-fast",
    "auto/free-cf-meta-llama-3-1-8b-instruct-fp8": "cfp/meta/llama-3.1-8b-instruct-fp8",
    "auto/free-cf-meta-llama-4-scout-17b-16e-instruct": "cfp/meta/llama-4-scout-17b-16e-instruct",
    "auto/free-cf-nvidia-nemotron-3-120b-a12b": "cfp/nvidia/nemotron-3-120b-a12b",
    "auto/free-cf-qwen-qwen2-5-coder-32b-instruct": "cfp/qwen/qwen2.5-coder-32b-instruct",
    "auto/free-cf-qwen-qwen3-30b-a3b-fp8": "cfp/qwen/qwen3-30b-a3b-fp8",
    "auto/free-cf-qwen-qwq-32b": "cfp/qwen/qwq-32b",
    "auto/free-cf-deepseek-ai-deepseek-r1-distill-qwen-32b": "cfp/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "auto/free-cf-google-gemma-4-26b-a4b-it": "cfp/google/gemma-4-26b-a4b-it",
    "auto/free-cf-mistralai-mistral-small-3-1-24b-instruct": "cfp/mistralai/mistral-small-3.1-24b-instruct",
    "auto/free-cf-ibm-granite-granite-4-0-h-micro": "cfp/ibm-granite/granite-4.0-h-micro",
    "auto/free-cf-aisingapore-gemma-sea-lion-v4-27b-it": "cfp/aisingapore/gemma-sea-lion-v4-27b-it",
    'anthropic/claude-haiku-4.5': 'ddgw/claude-haiku-4-5',
    'deepseek/deepseek-v4-flash': 'ds-web/deepseek-v4-flash',
    'deepseek/deepseek-v4-pro': 'ds-web/deepseek-v4-pro',
    'deepseek/deepseek-v4-pro-think': 'ds-web/deepseek-v4-pro-think',
    'deepseek/deepseek-v4-pro-search': 'ds-web/deepseek-v4-pro-search',
    'deepseek/deepseek-v4-pro-think-search': 'ds-web/deepseek-v4-pro-think-search',
    'deepseek/deepseek-v4-flash-think': 'ds-web/deepseek-v4-flash-think',
    'deepseek/deepseek-v4-flash-search': 'ds-web/deepseek-v4-flash-search',
    'deepseek/deepseek-v4-flash-think-search': 'ds-web/deepseek-v4-flash-think-search',
    'auto/free-gpt-5.4-mini': 'ddgw/gpt-5.4-mini',
    'auto/free-gpt-5.6-luna': 'ddgw/gpt-5.6-luna',
    'auto/free-mistral-small-2603': 'ddgw/mistral-small-2603',
    'auto/free-gpt-oss-120b': 'ddgw/tinfoil/gpt-oss-120b',
    'auto/free-gemma4-31b': 'ddgw/tinfoil/gemma4-31b',
}
INCLUDED_ROUTES = {
    **FREE_ROUTES,
    'auto/best-coding': 'cx/gpt-6.1-sol',
    'auto/best-reasoning': 'cx/gpt-6-astra',
    'auto/best-vision': 'cx/gpt-6.1-sol',
    'auto/best-fast': 'ds-web/deepseek-v4-flash',
    'auto/best-chat': 'ds-web/deepseek-v4-flash',
}
ALLOWED_MODELS = {(p.provider,p.model) for p in (*PROFILES.values(),*INCLUDED_PROFILES.values())} | {p.fallback for p in PROFILES.values()} | LEGACY_SPECIALISTS | {('auto', model) for model in OMNIROUTE_AUTO_MODELS} | {tuple(public.split('/',1)) for public in FREE_ROUTES} | {('muse', 'muse-spark-1.3')}

def included_routing():
    from app.config import settings
    return bool(settings.OMNIROUTE_URL and settings.MODEL_ROUTING_POLICY == 'codex_and_free')

def routing_profiles():
    return INCLUDED_PROFILES if included_routing() else PROFILES


def task_specialty(prompt, role='', modalities=None):
    """Route only the current user task and trusted agent role, not retrieved text."""
    if (modalities or set()) & {'image','pdf','video'}:
        return 'vision'
    role = role.casefold()
    for kind, roles in {'coding':('developer','builder'), 'research':('researcher',), 'writing':('writer','creative director'), 'review':('reviewer',), 'execution':('operations','runner')}.items():
        if role in roles:
            return kind
    rules = (
        ('coding', r'\b(code|coding|debug|bug|implement|python|typescript|javascript|repository|unit tests?|software)\b'),
        ('review', r'\b(review|audit|fact.check|verify the|check (?:my|this|the) (?:work|answer|code))\b'),
        ('analysis', r'\b(calculate|equation|math|statistics|dataset|csv|analy[sz]e (?:these|this|the) (?:data|numbers|results))\b'),
        ('research', r'\b(research|search|look up|latest|current|sources|find out|news)\b'),
        ('writing', r'\b(write|draft|rewrite|edit|story|poem|copy|translate|translation)\b'),
        ('planning', r'\b(?:book|reserve|reschedule|arrange)\b[^.!?\n]{0,100}\b(?:hotel|room|flight|table|trip|reservation|restaurant|appointment)\b|\bcheck me in\b'),
        ('planning', r'\b(plan|strategy|architect|reason through|think deeply|prove)\b'),
    )
    return next((kind for kind,pattern in rules if re.search(pattern,prompt,re.I)), 'general')


def model_route_id(provider, model):
    normalized = {"gemini": "google", "spacexai": "xai"}.get(provider, provider)
    return f'{normalized}/{model}'
