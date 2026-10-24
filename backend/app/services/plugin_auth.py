"""Durable browser OAuth for remote MCP servers, using the pinned MCP SDK."""
import base64
import hashlib
import json
import os
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
CLIENT_METADATA_PATH = '/api/plugin-oauth/client-metadata'

async def configure_client(storage, callback_url, client_id, client_secret=None, scope=None):
    """Store this user's registered client, never a token from another app."""
    metadata = OAuthClientMetadata(
        client_name='Cypher', redirect_uris=[callback_url],
        grant_types=['authorization_code', 'refresh_token'], response_types=['code'],
        token_endpoint_auth_method='client_secret_post' if client_secret else 'none',
        scope=scope or None,
    )
    client = OAuthClientInformationFull(**metadata.model_dump(mode='json'), client_id=client_id, client_secret=client_secret)
    await storage.update(client_metadata=metadata.model_dump(mode='json'), client_info=client.model_dump(mode='json'), custom_oauth_client=True)


def callback_url_for(origin=None):
    configured = os.getenv('GROKBOT_PUBLIC_URL', 'https://open-grokbot-hiveapp.vercel.app').rstrip('/')
    allowed = {configured, *(value.strip().rstrip('/') for value in os.getenv('GROKBOT_OAUTH_ALLOWED_ORIGINS', '').split(',') if value.strip())}
    chosen = origin if origin is not None else configured
    parsed = urlsplit(chosen)
    local = parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1'}
    if chosen not in allowed or (parsed.scheme != 'https' and not local) or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('The sign-in origin must be an approved app domain.')
    return chosen + '/api/plugin-oauth/callback'

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
        requested_scope = (self.context.client_metadata.scope or '').strip()
        if requested_scope:
            # A manually registered client can choose an explicit scope set.
            params['scope'] = requested_scope
        else:
            # Default to the provider's full advertised scope set so a user
            # does not accidentally connect an MCP with a partial grant.
            # The provider still decides what it will actually authorize.
            available_scopes = []
            for source in (metadata, self.context.protected_resource_metadata):
                scopes = getattr(source, 'scopes_supported', None)
                for scope in (scopes if isinstance(scopes, (list, tuple)) else []):
                    if isinstance(scope, str) and scope and not any(char.isspace() for char in scope):
                        if scope not in available_scopes:
                            available_scopes.append(scope)
            if available_scopes:
                scope_value = ' '.join(available_scopes)
                if len(scope_value) > 4096 or len(available_scopes) > 200:
                    raise ValueError('The provider advertises too many permission scopes for a secure sign-in request.')
                params['scope'] = scope_value
        if self.context.should_include_resource_param(self.context.protocol_version): params['resource']=self.context.get_resource_url()
        await storage.update(
            verifier=pkce.code_verifier,
            client_metadata=self.context.client_metadata.model_dump(mode='json'),
            oauth_metadata=metadata.model_dump(mode='json'),
            resource_metadata=self.context.protected_resource_metadata.model_dump(mode='json') if self.context.protected_resource_metadata else None,
            auth_server_url=self.context.auth_server_url, protocol_version=self.context.protocol_version,
            client_metadata_url=self.context.client_metadata_url,
            authorization_url=endpoint+('&' if '?' in endpoint else '?')+urlencode(params),
        )
        storage.row.state_hash=hashlib.sha256(state.encode()).hexdigest()
        storage.row.status='awaiting_login'; await storage.db.commit()
        raise SignInRequired('Sign in to finish connecting.')

async def make_provider(db, row, callback_url=None):
    storage=DatabaseTokenStorage(db,row); saved=storage.read()
    metadata=OAuthClientMetadata.model_validate(saved['client_metadata']) if saved.get('client_metadata') else OAuthClientMetadata(
        client_name='Cypher', redirect_uris=[callback_url], grant_types=['authorization_code','refresh_token'],
        response_types=['code'], token_endpoint_auth_method='none',
    )
    callback = urlsplit(str(metadata.redirect_uris[0]))
    metadata_url = saved.get('client_metadata_url') or (urlunsplit((callback.scheme, callback.netloc, CLIENT_METADATA_PATH, '', '')) if callback.scheme == 'https' else None)
    if saved.get('custom_oauth_client'):
        metadata_url = None
    # Lovable advertises CIMD but currently rejects unapproved client-ID domains.
    # Its supported alternatives are approved DCR callbacks or a workspace client.
    if urlsplit(row.url).hostname == 'mcp.lovable.dev':
        metadata_url = None
        client_id = os.getenv('LOVABLE_OAUTH_CLIENT_ID', '').strip()
        # Lovable's official MCP instructions require this public client ID for
        # clients outside its first-party integrations. Keep it scoped to the
        # stable Cypher callback; self-hosted/custom domains can configure theirs.
        if not client_id and callback.hostname == 'cypher-agent.vercel.app':
            client_id = '6d465f583e1e4ce5801b1616f735670c'
        if client_id and not saved.get('client_info'):
            client_secret = os.getenv('LOVABLE_OAUTH_CLIENT_SECRET', '').strip() or None
            client = OAuthClientInformationFull(
                **{**metadata.model_dump(mode='json'), 'token_endpoint_auth_method': 'client_secret_post' if client_secret else 'none'},
                client_id=client_id, client_secret=client_secret,
            )
            await storage.set_client_info(client)
    provider=BrowserOAuthProvider(server_url=row.url,client_metadata=metadata,storage=storage,client_metadata_url=metadata_url)
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
