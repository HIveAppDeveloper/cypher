import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).resolve().parents[1] / 'public/setup/cypher_host.py'
spec = importlib.util.spec_from_file_location('cypher_host', path)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class SelfHostSetupTests(unittest.TestCase):
    def values(self, target='local'):
        return setup.configuration(target, 'https://models.example.test', 'postgresql://fixture:fixture@database.example.test/fixture', 'https://gateway.example.test', 'fixture-key', 'owner@example.test', 'fixture-resend-key', 'signin@example.test')

    def test_private_generation_preserves_existing_files(self):
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / 'installation'
            setup.write_configuration(destination, self.values())
            self.assertEqual(os.stat(destination / '.env').st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(destination).st_mode & 0o777, 0o700)
            before = (destination / '.env').read_bytes()
            with self.assertRaises(FileExistsError):
                setup.write_configuration(destination, self.values())
            self.assertEqual((destination / '.env').read_bytes(), before)

    def test_local_is_loopback_only_and_cloud_requires_sign_in(self):
        self.assertEqual(self.values()['REQUIRE_USER_AUTH'], 'false')
        self.assertEqual(self.values()['GROKBOT_PUBLIC_URL'], 'http://localhost:3000')
        self.assertIn('127.0.0.1:3000:3000', setup.COMPOSE)
        self.assertEqual(self.values('aws')['REQUIRE_USER_AUTH'], 'true')
        self.assertRegex(self.values('azure')['DATABASE_SCHEMA'], r'^cypher_[a-f0-9]{12}$')
        self.assertNotEqual(self.values()['CYPHER_PROJECT_NAME'], self.values()['CYPHER_PROJECT_NAME'])
        self.assertNotEqual(self.values()['DATABASE_SCHEMA'], self.values()['DATABASE_SCHEMA'])
        with self.assertRaises(ValueError):
            setup.configuration('aws', 'https://models.example.test', 'postgresql://a:b@db.test/db', 'https://gateway.test', 'fixture-key')

    def test_no_host_docker_socket_or_credential_defaults(self):
        self.assertNotIn('/var/run/docker.sock', setup.COMPOSE)
        self.assertNotIn('postgres:', setup.COMPOSE)
        self.assertGreaterEqual(len(self.values()['SECRET_KEY']), 48)
        self.assertNotEqual(self.values()['AUTH_SESSION_SECRET'], self.values()['AUTH_SESSION_SECRET'])
        self.assertNotIn('fixture-key', setup.COMPOSE)

    def test_bad_origin_and_database_formats_fail_before_files_are_created(self):
        for origin in ['http://public.test', 'https://user:secret@host.test', 'https://host.test/path', 'https://host.test?secret=yes', 'https://bad{host.test']:
            with self.assertRaises(ValueError): setup.https_origin(origin)
        for url in ['prisma://accelerate.test/key', 'sqlite:///file.db', 'postgresql://database.test/db', 'postgresql://a:b@database.test/']:
            with self.assertRaises(ValueError): setup.database_url(url)
        with self.assertRaises(ValueError): setup.env_value('secret\nBAD=value')

if __name__ == '__main__': unittest.main()
