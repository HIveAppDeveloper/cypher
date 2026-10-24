"""Render the real sign-in payload through a mocked Resend transport."""
from email.utils import parseaddr
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.api import auth


class RenderedEmail(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self.language = None
        self.text = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'html': self.language = attrs.get('lang')
        if tag == 'a': self.links.append(attrs.get('href'))

    def handle_data(self, text):
        self.text.append(text)


@pytest.mark.asyncio
@pytest.mark.parametrize('sender', [
    'login@auth.example.com',
    'Open GrokBot <login@auth.example.com>',
    '"Workspace, Notifications" <login@auth.example.com>',
])
async def test_sign_in_email_brands_cypher_and_preserves_sender_and_link(monkeypatch, sender):
    sent = []
    def capture(request):
        import json
        assert request.method == 'POST'
        assert str(request.url) == 'https://api.resend.com/emails'
        sent.append(json.loads(request.content))
        return httpx.Response(200, json={'id': 'fixture-email-only'})

    client = httpx.AsyncClient(transport=httpx.MockTransport(capture))
    monkeypatch.setattr(auth.httpx, 'AsyncClient', lambda **kwargs: client)
    monkeypatch.setenv('GROKBOT_RESEND_API_KEY', 'fixture-only-never-sent')
    monkeypatch.setattr(auth.settings, 'GROKBOT_AUTH_FROM', sender)
    monkeypatch.setattr(auth.settings, 'GROKBOT_PUBLIC_URL', 'https://cypher.example')

    await auth.send_magic_link('recipient@example.com', 'fixture-token', '/workspace?source=email&view=work')
    assert len(sent) == 1
    payload = sent[0]
    assert parseaddr(payload['from']) == ('Cypher', parseaddr(sender)[1])
    assert payload['to'] == ['recipient@example.com']
    assert payload['subject'] == 'Your Cypher sign-in link'
    assert 'Cypher' in payload['text']
    assert 'Open GrokBot' not in payload['subject'] + payload['text'] + payload['html'] + payload['from']

    rendered = RenderedEmail()
    rendered.feed(payload['html'])
    assert rendered.language == 'en'
    assert len(rendered.links) == 1
    link = rendered.links[0]
    assert link in payload['text']
    assert urlsplit(link).netloc == 'cypher.example'
    assert urlsplit(link).path == '/api/auth/email/verify'
    assert parse_qs(urlsplit(link).query) == {'token': ['fixture-token'], 'return_to': ['/workspace?source=email&view=work']}
    assert 'Sign in to Cypher' in ''.join(rendered.text)
    assert '15 minutes and works once' in ''.join(rendered.text)
    assert 'If you did not request it, ignore this email.' in ''.join(rendered.text)
