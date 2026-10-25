import pytest

from app.config import settings
from app.services.omniroute import cloud_project_matches


@pytest.mark.parametrize('url,expected', [
    ('https://omniroute-cloud-ten.vercel.app/v1', True),
    ('https://omniroute-cloud-hiveapp.vercel.app/', True),
    ('https://omniroute-cloud-p5iyakp1h-hiveapp.vercel.app/v1', True),
    ('https://another-gateway.example/v1', False),
    ('https://omniroute-cloud-ten.vercel.app.evil.example/v1', False),
    ('https://omniroute-cloud-ten.vercel.app:8443/v1', False),
    ('https://secret@omniroute-cloud-ten.vercel.app/v1', False),
    ('https://omniroute-cloud-ten.vercel.app/v1?key=secret', False),
    ('', False),
    ('https://[not-a-host', False),
])
def test_gateway_diagnostic_reports_only_validated_host_equality(monkeypatch, url, expected):
    monkeypatch.setattr(settings, 'OMNIROUTE_URL', url)
    monkeypatch.setattr(settings, 'OMNIROUTE_API_KEY', 'fixture-only-key')
    result = cloud_project_matches()
    assert type(result) is bool and result is expected
