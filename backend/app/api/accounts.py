"""Expose configuration state, never mailbox credentials or delegated ChatGPT tokens."""
import os
from fastapi import APIRouter
router=APIRouter()
@router.get('/status')
async def status():
    resend=bool(os.getenv('GROKBOT_RESEND_API_KEY'))
    gmail=all(os.getenv(key) for key in ('GROKBOT_GMAIL_CLIENT_ID','GROKBOT_GMAIL_CLIENT_SECRET','GROKBOT_GMAIL_REFRESH_TOKEN'))
    return {'gmail':{'configured':gmail,'detail':'App OAuth credentials and a mailbox grant are configured; not yet live verified.' if gmail else 'Needs app OAuth client ID, client secret, and a Gmail mailbox grant. ChatGPT connections are separate.'},'resend':{'configured':resend,'detail':'App credential configured; not yet live verified.' if resend else 'No app receiving credential is configured. Production credential storage was blocked during setup.'}}
