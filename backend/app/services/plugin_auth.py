"""Durable browser OAuth for remote MCP servers, using the pinned MCP SDK."""
import base64
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode, urlsplit, urlunsplit
from mcp.client.auth import OAuthClientProvider
from mcp.client.auth.oauth2 import PKCEParameters
from mcp.shared.auth import OAuthClientInformationFull, OAuthClientMetadata, OAuthMetadata, OAuthToken, ProtectedResourceMetadata
from sqlalchemy import select
from app.models.plugin import PluginAuthorization
from app.services.plugins import seal, reveal, validate_endpoint

FLOW_TTL = 600

class SignInRequired(ValueError):
    pass

class DatabaseTokenStorage:
    def __init__(self, db, row):
        self.db, self.row = db, row
    def read(self):
        return json.loads(reveal(self.row.payload) or '{}') if self.row.payload else {}
    async def update(self, **fields):
        data = self.read(); data.update(fields)
        self.row.payload = seal(json.dumps(data)); await self.db.commit()
    async def get_tokens(self):
        data = self.read(); token = data.get('tokens')
        if not token: return None
        token = dict(token)
        if data.get('expires_at'):
            token['expires_in'] = max(0, int(data['expires_at'] - time.time()))
        return OAuthToken.model_validate(token)
    async def set_tokens(self, tokens):
        previous = self.read().get('tokens') or {}
        token = tokens.model_dump(mode='json', exclude_none=True)
        if not token.get('refresh_token') and previous.get('refresh_token'):
            token['refresh_token'] = previous['refresh_token']
        await self.update(tokens=token, expires_at=time.time()+tokens.expires_in if tokens.expires_in is not None else None)
    async def get_client_info(self):
        data=self.read().get('client_info')
        return OAuthClientInformationFull.model_validate(data) if data else None
    async def set_client_info(self, client_info):
        await self.update(client_info=client_info.model_dump(mode='json'))

class BrowserOAuthProvider(OAuthClientProvider):
    async def _perform_authorization_code_grant(self):
        """Pause at consent; persist the exact SDK-discovered issuer and PKCE verifier."""
        storage=self.context.storage
        if storage.row.status == 'connected':
            raise SignInRequired('This connection needs sign-in again. Reconnect it from Plugins.')
        metadata=self.context.oauth_metadata
        if not metadata or not metadata.authorization_endpoint or not self.context.client_info:
            raise ValueError('This service does not publish a supported automatic sign-in flow.')
        if 'S256' not in (metadata.code_challenge_methods_supported or []):
            raise ValueError('This service does not support the secure login flow required by this app.')
        endpoint=str(metadata.authorization_endpoint)
        await validate_endpoint(urlunsplit((*urlsplit(endpoint)[:3], '', '')))
        pkce=PKCEParameters.generate(); state=storage.row.id+'.'+secrets.token_urlsafe(32)
        params={
            'response_type':'code', 'client_id':self.context.client_info.client_id,
            'redirect_uri':str(self.context.client_metadata.redirect_uris[0]),
            'state':state,'code_challenge':pkce.code_challenge,'code_challenge_method':'S256',
        }
        if self.context.client_metadata.scope: params['scope']=self.context.client_metadata.scope
        if self.context.should_include_resource_param(self.context.protocol_version): params['resource']=self.context.get_resource_url()
        await storage.update(
            verifier=pkce.code_verifier,
            client_metadata=self.context.client_metadata.model_dump(mode='json'),
            oauth_metadata=metadata.model_dump(mode='json'),
            resource_metadata=self.context.protected_resource_metadata.model_dump(mode='json') if self.context.protected_resource_metadata else None,
            auth_server_url=self.context.auth_server_url, protocol_version=self.context.protocol_version,
            authorization_url=endpoint+('&' if '?' in endpoint else '?')+urlencode(params),
        )
        storage.row.state_hash=hashlib.sha256(state.encode()).hexdigest()
        storage.row.status='awaiting_login'; await storage.db.commit()
        raise SignInRequired('Sign in to finish connecting.')

async def make_provider(db, row, callback_url=None):
    storage=DatabaseTokenStorage(db,row); saved=storage.read()
    metadata=OAuthClientMetadata.model_validate(saved['client_metadata']) if saved.get('client_metadata') else OAuthClientMetadata(
        client_name='GrokBot', redirect_uris=[callback_url], grant_types=['authorization_code','refresh_token'],
        response_types=['code'], token_endpoint_auth_method='none',
    )
    provider=BrowserOAuthProvider(server_url=row.url,client_metadata=metadata,storage=storage)
    if saved.get('oauth_metadata'): provider.context.oauth_metadata=OAuthMetadata.model_validate(saved['oauth_metadata'])
    if saved.get('resource_metadata'): provider.context.protected_resource_metadata=ProtectedResourceMetadata.model_validate(saved['resource_metadata'])
    provider.context.auth_server_url=saved.get('auth_server_url')
    provider.context.protocol_version=saved.get('protocol_version')
    provider.context.token_expiry_time=saved.get('expires_at')
    return provider

async def provider_for_plugin(db, plugin_id):
    row=(await db.execute(select(PluginAuthorization).where(PluginAuthorization.plugin_id==plugin_id,PluginAuthorization.status=='connected'))).scalar_one_or_none()
    if not row or not DatabaseTokenStorage(db,row).read().get('tokens'):return None
    return await make_provider(db,row)
