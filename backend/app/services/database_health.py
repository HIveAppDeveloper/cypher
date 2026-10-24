"""Bound startup retries and return useful, credential-free database failures."""
import asyncio
import logging

logger = logging.getLogger(__name__)


def failure_detail(error):
    reason = str(error).lower()
    if any(word in reason for word in ('exceeded the quota', 'quota exceeded', 'usage limit', 'spend limit')):
        return {'code': 'database_quota', 'detail': 'The database provider has paused access because its usage limit was reached. The workspace owner must restore database access or adjust the provider plan. Your saved conversations have not been deleted.', 'retry_after': 300}
    return {'code': 'database_unavailable', 'detail': 'The database is temporarily unavailable. Your saved work is preserved. Reconnecting automatically.', 'retry_after': 30}


async def initialize(app, engine):
    from app.db.bootstrap import initialize_database
    try:
        async with asyncio.timeout(20):
            await initialize_database(engine)
        app.state.database_ready = True
        app.state.database_failure = None
        return True
    except Exception as error:
        app.state.database_ready = False
        app.state.database_failure = failure_detail(error)
        logger.error('Database unavailable code=%s type=%s', app.state.database_failure['code'], type(error).__name__)
        return False


async def recover(app, engine):
    while True:
        detail = getattr(app.state, 'database_failure', None)
        await asyncio.sleep(detail['retry_after'] if detail else 30)
        if not app.state.database_ready:
            await initialize(app, engine)
