"""Check explicit owner-requested prose limits before publishing a final reply."""
import re

def word_limit(request):
    matches=list(re.finditer(r'\b(under|fewer than|less than|at most|no more than|max(?:imum)?(?: of)?)\s+(\d{1,4})[ -]+words?\b',request,re.I))
    if not matches:return None
    match=matches[-1];limit=int(match[2])-(1 if match[1].casefold() in {'under','fewer than','less than'} else 0)
    return limit if 1<=limit<=2000 else None

def word_count(answer):
    # Match rendered prose: link destinations are not visible words.
    return len(re.findall(r'\S+',re.sub(r'!?\[([^\]]*)\]\([^)]*\)',r'\1',answer)))

def steer_limit(previous,direction):
    requested=word_limit(direction)
    if requested is not None:return requested
    if re.search(r'\b(?:ignore|remove|drop).{0,25}(?:word|length).{0,12}limit|\b(?:longer|more detailed)\b',direction,re.I):return None
    return previous
