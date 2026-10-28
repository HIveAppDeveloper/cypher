import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
from email.message import Message

spec = importlib.util.spec_from_file_location('public_readiness', Path(__file__).with_name('public-readiness.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PublicReadinessChecks(unittest.TestCase):
    def test_accept_encoding_is_not_accept_and_tokens_are_case_insensitive(self):
        self.assertNotIn('accept', module.vary_tokens('RSC, Accept-Encoding'))
        self.assertIn('accept', module.vary_tokens('RSC, Accept-Encoding, ACCEPT'))
        self.assertEqual(module.vary_tokens('  Accept , Accept,  RSC '), {'accept', 'rsc'})

    def test_root_slash_is_normalized_without_masking_another_page_or_origin(self):
        self.assertEqual(module.normalized_url('https://cypher-agent.vercel.app'), module.normalized_url('https://cypher-agent.vercel.app/'))
        self.assertNotEqual(module.normalized_url('https://cypher-agent.vercel.app/'), module.normalized_url('https://cypher-agent.vercel.app/about'))
        self.assertNotEqual(module.normalized_url('https://other.example/'), module.normalized_url('https://cypher-agent.vercel.app/'))

    def test_multiple_vary_header_lines_are_combined_before_exact_token_matching(self):
        headers = Message()
        headers.add_header('Vary', 'RSC, Accept-Encoding')
        headers.add_header('Vary', 'Accept')
        self.assertEqual(module.vary_tokens(module.vary_header(headers)), {'rsc', 'accept-encoding', 'accept'})

    def test_protection_headers_allow_bypass_or_only_vercel_cookies(self):
        self.assertEqual(module.protection_headers({'x-vercel-protection-bypass': 'fixture-only'}), {'x-vercel-protection-bypass': 'fixture-only'})
        self.assertEqual(module.protection_headers({'cookie': '_vercel_jwt=fixture.a=b; _vercel_toolbar=on'}), {'Cookie': '_vercel_jwt=fixture.a=b; _vercel_toolbar=on'})

    def test_protection_headers_reject_app_sessions_authorization_invalid_pairs_and_controls(self):
        for content in [
            {'Cookie': 'grokbot_session=fixture'},
            {'Cookie': '_vercel_jwt=fixture; grokbot_session=fixture'},
            {'Authorization': 'Bearer fixture'},
            {'Cookie': '_vercel_jwt=fixture', 'Authorization': 'fixture'},
            {'Cookie': '_vercel_jwt=fixture\r\nX-Other: value'},
            {'Cookie': '_vercel_jwt'},
            {'Cookie': '_vercel_jwt=a;'},
            {'Cookie': '_vercel_jwt=a; _vercel_jwt=b'},
            {'Cookie': '_vercel_jwt="quoted"'},
            {'Cookie': '_vercel_jwt=has space'},
            {'x-vercel-protection-bypass': 'fixture\nvalue'},
            {'Cookie': '_vercel_jwt=fixture\\other'},
        ]:
            with self.assertRaises(ValueError):
                module.protection_headers(content)

    def test_redirects_never_forward_protection_headers_to_any_destination(self):
        request = module.urllib.request.Request('https://stage.example/', headers={'Cookie': '_vercel_jwt=fixture'})
        self.assertIsNone(module.NoRedirect().redirect_request(request, None, 307, 'redirect', {}, 'https://other.example/'))

    def test_a_failed_run_exits_nonzero_and_replaces_a_stale_success_receipt(self):
        class Unavailable:
            def open(self, *_args, **_kwargs):
                raise urllib.error.URLError('controlled fixture failure')
        with tempfile.TemporaryDirectory() as folder:
            report = Path(folder) / 'report.json'
            report.write_text('{"status":"passed","stale":true}')
            with patch('sys.argv', ['public-readiness', '--report', str(report)]), patch.object(module.urllib.request, 'build_opener', return_value=Unavailable()), contextlib.redirect_stdout(io.StringIO()):
                exit_code = module.main()
            result = json.loads(report.read_text())
            self.assertEqual(exit_code, 1)
            self.assertEqual(result['status'], 'failed')
            self.assertNotIn('stale', result)
            self.assertEqual(len(result['requests']), 35)
            self.assertEqual(len(result['failures']), 35)


if __name__ == '__main__':
    unittest.main()
