"""Expose configuration state, never mailbox credentials or delegated ChatGPT tokens."""
import os
from fastapi import APIRouter
from app.services.resend import probe_receiving
router=APIRouter()
@router.get('/status')
async def status():
    resend=await probe_receiving()
    gmail=all(os.getenv(key) for key in ('GROKBOT_GMAIL_CLIENT_ID','GROKBOT_GMAIL_CLIENT_SECRET','GROKBOT_GMAIL_REFRESH_TOKEN'))
    return {'gmail':{'configured':gmail,'verified':False,'detail':'App OAuth credentials and a mailbox grant are configured; live mailbox access is checked only when Gmail is connected.' if gmail else 'Needs app OAuth client ID, client secret, and a Gmail mailbox grant. ChatGPT connections are separate.'},'resend':resend}
