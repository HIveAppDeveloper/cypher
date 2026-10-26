"""Cache the upstream ONNX export in the image, checking every downloaded byte."""
import hashlib
import os
from pathlib import Path
import urllib.request

ASSETS = {
    "kokoro-v1.0.int8.onnx": "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
BASE_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"


def download(root: Path):
    root.mkdir(parents=True, exist_ok=True)
    for name, expected in ASSETS.items():
        path = root / name
        if not path.exists():
            temporary = root / (name + ".part")
            urllib.request.urlretrieve(BASE_URL + name, temporary)
            temporary.replace(path)
        with path.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        if digest != expected:
            raise RuntimeError(f"Model checksum mismatch: {name}")


if __name__ == "__main__":
    download(Path(os.environ.get("KOKORO_MODEL_DIR", "/opt/models")))
