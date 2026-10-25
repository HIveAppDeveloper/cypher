"""Voice-turn defaults; typed requests and explicit model selection stay intact."""
import re

VOICE_INSTRUCTIONS = (
    '\nThis is a live spoken conversation. Start with the direct answer. '
    'Prefer one to three short sentences unless the user asks for detail. '
    'Use the existing enabled tools when needed, verify their receipts, and '
    'never claim an action ran merely because you described it. '
    'Keep necessary facts, source links and requested deliverables on screen.'
)

def voice_options(options):
    if not options.voice_mode:
        return options
    return options.model_copy(update={
        'max_tokens': min(options.max_tokens, 1024),
        'reasoning_effort': options.reasoning_effort or 'none',
    })

def speech_request(prepared):
    from app.services.attachments import PreparedAttachments
    return prepared.speech_text if isinstance(prepared, PreparedAttachments) else ''

def requests_teammates(message, bots, lead):
    # Preserve explicit named/unique-role participation and the normal bounded
    # planner when requested; ordinary speech needs no plan + synthesis round.
    labels = {label for bot in bots if bot.id != lead.id for label in (bot.name, bot.role) if label}
    if any(re.search(r'(?<!\w)' + re.escape(label) + r'(?!\w)', message, re.I) for label in labels):
        return True
    return bool(re.search(r'\b(?:ask|consult|delegate|coordinate|involve|use|work with)\b[^.!?\n]{0,70}\b(?:team|teammates|specialists|agents)\b', message, re.I))
