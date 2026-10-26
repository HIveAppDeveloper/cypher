"""Conservative automatic chat policy. Explicit user settings always win."""
import re

_SMALL_TALK = re.compile(
    r'\s*(?:hi|hello|hey|good morning|good afternoon|good evening|'
    r'thanks|thank you|thanks a lot|thank you very much|bye|goodbye)[!.,\s]*',
    re.IGNORECASE,
)


def effective_run(options, specialty, prompt, modalities, *, history_size=0):
    if options.routing != 'auto':
        return options, specialty
    updates = {}
    # No routing-classifier call, no truncation, and never downgrade attachments,
    # task instructions or an explicitly selected provider/model/effort.
    if (not options.model and not options.provider and options.reasoning_effort is None
            and not options.voice_mode and specialty == 'general' and history_size <= 1
            and modalities == {'text'} and _SMALL_TALK.fullmatch(prompt)):
        specialty = 'execution'
        updates['max_tokens'] = min(options.max_tokens, 256)
        updates['allow_tools'] = False
    if options.reasoning_effort is None and specialty in {'general', 'execution', 'research', 'writing', 'vision'}:
        updates['reasoning_effort'] = 'low'
    return options.model_copy(update=updates) if updates else options, specialty
