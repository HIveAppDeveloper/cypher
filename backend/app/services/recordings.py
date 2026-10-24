"""Give browser MediaRecorder uploads a seekable, duration-bearing container."""
import json
import subprocess
import tempfile
from pathlib import Path


class RecordingError(ValueError):
    pass


def audio_only_mime(data: bytes, mime: str) -> str | None:
    """Distinguish a saved audio recording from video in an ambiguous container."""
    audio_mime = {'video/webm': 'audio/webm', 'video/mp4': 'audio/mp4',
                  'video/quicktime': 'audio/mp4'}.get(mime)
    if not audio_mime:
        return None
    if not 0 < len(data) <= 3 * 1024 * 1024:
        raise RecordingError('The recording is empty or too large. Send a shorter recording.')
    with tempfile.TemporaryDirectory(prefix='cypher-recording-kind-') as directory:
        source = Path(directory) / 'recording'
        source.write_bytes(data)
        try:
            probe = subprocess.run([
                'ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                '-format_whitelist', 'mov,matroska,webm', '-show_entries',
                'stream=codec_type', '-of', 'json', str(source),
            ], check=True, timeout=15, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True)
            kinds = {stream.get('codec_type') for stream in json.loads(probe.stdout).get('streams', [])}
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            raise RecordingError('The recording could not be decoded. Please upload a playable recording.') from error
    # MediaRecorder streams need not contain duration metadata. Actual video
    # still goes through the existing frame, duration and speech checks.
    return audio_mime if 'audio' in kinds and 'video' not in kinds else None


def normalize_recording(data: bytes, mime: str) -> tuple[bytes, str, str]:
    if mime not in {'audio/webm', 'audio/mp4', 'audio/ogg'}:
        return data, mime, ''
    # MediaRecorder WebM streams commonly omit the container duration. The
    # offline speech worker validates duration before decoding and rejects them.
    # A file output lets ffmpeg write the MP3 duration header after encoding.
    with tempfile.TemporaryDirectory(prefix='cypher-recording-') as directory:
        source = Path(directory) / 'recording'
        target = Path(directory) / 'speech.mp3'
        source.write_bytes(data)
        try:
            subprocess.run([
                'ffmpeg', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                '-format_whitelist', 'mov,matroska,webm,ogg',
                '-i', str(source), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
                '-c:a', 'libmp3lame', '-b:a', '64k', '-fs', str(3 * 1024 * 1024 + 1),
                str(target),
            ], check=True, timeout=30, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            result = target.read_bytes()
        except (OSError, subprocess.SubprocessError) as error:
            raise RecordingError('The recording could not be decoded. Please record it again.') from error
        if not result or len(result) > 3 * 1024 * 1024:
            raise RecordingError('The recording is too long. Please send a shorter recording.')
        return result, 'audio/mpeg', 'mp3'
