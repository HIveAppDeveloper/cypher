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
    'review': Profile('xai', 'grok-4.7', ('openai', 'gpt-6.1-sol')),
    'execution': Profile('openai', 'gpt-6-luna', ('openai', 'gpt-6.1-sol')),
    'vision': Profile('gemini', 'gemini-3.8-flash', ('openai', 'gpt-6.1-sol')),
}
LEGACY_SPECIALISTS = {('gemini','gemini-3.5-flash'), ('anthropic','claude-sonnet-4.6'), ('deepseek','deepseek-v3.2')}
OMNIROUTE_AUTO_MODELS = {'best-coding', 'best-reasoning', 'best-vision', 'best-fast', 'best-chat'}
ALLOWED_MODELS = {(p.provider,p.model) for p in PROFILES.values()} | {p.fallback for p in PROFILES.values()} | LEGACY_SPECIALISTS | {('auto', model) for model in OMNIROUTE_AUTO_MODELS}


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
