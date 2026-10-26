"""Local bounded roster selection; a 200-member room is not 200 model calls."""
import re

ROSTER_LIMIT = 8
DIRECT_TEAM_LIMIT = 8


def relevant_bots(bots, message, lead=None, limit=ROSTER_LIMIT):
    words = set(re.findall(r'[a-z0-9]+', message.casefold()))
    def score(bot):
        name = str(bot.name).casefold()
        role = str(bot.role or '').casefold()
        names = set(re.findall(r'[a-z0-9]+', name))
        roles = set(re.findall(r'[a-z0-9]+', role))
        return (20 if name and re.search(r'(?<!\w)'+re.escape(name)+r'(?!\w)', message, re.I) else 0) + 4*len(words & names) + 2*len(words & roles)
    ranked = sorted(enumerate(bots), key=lambda pair: (-score(pair[1]), pair[0]))
    selected = [lead] if lead is not None else []
    selected.extend(bot for _, bot in ranked if lead is None or bot.id != lead.id)
    return selected[:limit]
