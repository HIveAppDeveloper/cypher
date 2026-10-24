"""Give browser MediaRecorder uploads a seekable, duration-bearing container."""
import subprocess
import tempfile
from pathlib import Path


class RecordingError(ValueError):
    pass


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
