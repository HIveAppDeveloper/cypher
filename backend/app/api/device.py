"""Optional WebAuthn approval for new plugin connections in the private owner workspace."""
import os,json,base64
from datetime import datetime,timedelta
from urllib.parse import urlsplit
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import select,delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.context import DeviceCredential,DeviceChallenge
from webauthn import generate_registration_options,generate_authentication_options,options_to_json,verify_registration_response,verify_authentication_response,base64url_to_bytes
from webauthn.helpers.structs import AuthenticatorSelectionCriteria,AuthenticatorAttachment,UserVerificationRequirement,PublicKeyCredentialDescriptor
router=APIRouter()
ORIGIN=os.getenv('GROKBOT_PUBLIC_ORIGIN','https://open-grokbot-hiveapp.vercel.app').rstrip('/')
RP_ID=urlsplit(ORIGIN).hostname
def encode(value):return base64.urlsafe_b64encode(value).decode().rstrip('=')
class ChallengeInput(BaseModel):
    purpose:str=Field(default='register',max_length=1100)
class VerifyInput(BaseModel):
    challenge_id:str=Field(max_length=36)
    credential:dict
@router.get('/status')
async def status(db:AsyncSession=Depends(get_db)):
    return {'enrolled':bool((await db.execute(select(DeviceCredential.id).limit(1))).first()),'origin':ORIGIN}
@router.post('/challenge')
async def challenge(body:ChallengeInput,db:AsyncSession=Depends(get_db)):
    await db.execute(delete(DeviceChallenge).where(DeviceChallenge.expires_at<datetime.utcnow()))
    credentials=(await db.execute(select(DeviceCredential))).scalars().all()
    if body.purpose=='register':
        if credentials:raise HTTPException(409,'A device passkey is already registered. Use that passkey or its synced copy.')
        options=generate_registration_options(rp_id=RP_ID,rp_name='GrokBot',user_id=b'grokbot-private-owner',user_name='Workspace owner',authenticator_selection=AuthenticatorSelectionCriteria(authenticator_attachment=AuthenticatorAttachment.PLATFORM,user_verification=UserVerificationRequirement.REQUIRED))
    elif body.purpose.startswith(('connect_plugin:','setup_account:')):
        if not credentials:raise HTTPException(409,'Set up device approval first.')
        options=generate_authentication_options(rp_id=RP_ID,allow_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.id)) for c in credentials],user_verification=UserVerificationRequirement.REQUIRED)
    else:raise HTTPException(422,'Unsupported approval action.')
    row=DeviceChallenge(challenge=encode(options.challenge),purpose=body.purpose,expires_at=datetime.utcnow()+timedelta(minutes=5));db.add(row);await db.commit()
    return {'challenge_id':row.id,'options':json.loads(options_to_json(options))}
@router.post('/verify')
async def verify(body:VerifyInput,db:AsyncSession=Depends(get_db)):
    row=(await db.execute(select(DeviceChallenge).where(DeviceChallenge.id==body.challenge_id).with_for_update())).scalar_one_or_none()
    if not row or row.used or row.expires_at<datetime.utcnow() or row.purpose.startswith('approved:'):raise HTTPException(400,'Device challenge expired or already used. Try again.')
    row.used=True;await db.commit()
    try:
        if row.purpose=='register':
            if (await db.execute(select(DeviceCredential.id).limit(1))).first():raise ValueError('Already enrolled')
            result=verify_registration_response(credential=body.credential,expected_challenge=base64url_to_bytes(row.challenge),expected_rp_id=RP_ID,expected_origin=ORIGIN,require_user_verification=True)
            db.add(DeviceCredential(id=encode(result.credential_id),public_key=encode(result.credential_public_key),sign_count=result.sign_count));await db.commit();return {'enrolled':True}
        credential=await db.get(DeviceCredential,body.credential.get('id',''))
        if not credential:raise ValueError('Unknown credential')
        result=verify_authentication_response(credential=body.credential,expected_challenge=base64url_to_bytes(row.challenge),expected_rp_id=RP_ID,expected_origin=ORIGIN,credential_public_key=base64url_to_bytes(credential.public_key),credential_current_sign_count=credential.sign_count,require_user_verification=True)
        credential.sign_count=result.new_sign_count
        approval=DeviceChallenge(challenge='',purpose='approved:'+row.purpose,expires_at=datetime.utcnow()+timedelta(minutes=2));db.add(approval);await db.commit();return {'approval_id':approval.id}
    except Exception:
        await db.rollback();raise HTTPException(400,'Device verification failed. Use your registered passkey and try again.')
async def require_device(db,approval_id,action):
    if not (await db.execute(select(DeviceCredential.id).limit(1))).first():return
    row=(await db.execute(select(DeviceChallenge).where(DeviceChallenge.id==approval_id).with_for_update())).scalar_one_or_none() if approval_id else None
    if not row or row.used or row.expires_at<datetime.utcnow() or row.purpose!='approved:'+action:raise HTTPException(403,'Confirm this plugin connection with your device.')
    row.used=True;await db.commit()
