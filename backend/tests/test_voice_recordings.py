import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from app.services.recordings import normalize_recording, RecordingError


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'ffmpeg is required')
class BrowserRecordingTests(unittest.TestCase):
    def test_streaming_webm_without_duration_becomes_seekable_speech(self):
        original = subprocess.run([
            'ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
            'sine=frequency=440:duration=1', '-c:a', 'libopus', '-f', 'webm', 'pipe:1',
        ], check=True, capture_output=True).stdout
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'browser.webm'
            source.write_bytes(original)
            probe = lambda path: json.loads(subprocess.check_output([
                'ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', str(path),
            ]))['format']
            self.assertNotIn('duration', probe(source))
            normalized, mime, extension = normalize_recording(original, 'audio/webm')
            output = Path(directory) / 'speech.mp3'
            output.write_bytes(normalized)
            self.assertGreater(float(probe(output)['duration']), .9)
            self.assertEqual((mime, extension), ('audio/mpeg', 'mp3'))
            self.assertEqual(source.read_bytes(), original)

    def test_corrupt_recording_fails_with_recovery_instruction(self):
        with self.assertRaisesRegex(RecordingError, 'record it again'):
            normalize_recording(b'not a recording', 'audio/webm')

    def test_other_formats_keep_original_bytes(self):
        self.assertEqual(normalize_recording(b'source', 'audio/mpeg'), (b'source', 'audio/mpeg', ''))
