"""Build-time only, pinned upstream model and native operator dependencies."""
import hashlib
from pathlib import Path
import urllib.request

REVISION = "330617ad1f097b4f6b02c103e54b39006c090b45"
OPTIMIZED_SHA256 = "6ab18cb6a4712a17061dea9e1a208da0554d9922c5fd93e1ccc932c3abd2d9f8"
ORT = "https://raw.githubusercontent.com/microsoft/onnxruntime/rel-1.23.2/include/onnxruntime/core/session/"
HF = f"https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.1/resolve/{REVISION}/"
ASSETS = {
    "paradee_int8.onnx": (HF + "onnx/paradee_int8.onnx", "665c3cce6d9872e24bd43db4aa19d3b9c224cdeb6d79b0814190e1c2e43defbc"),
    "paradee-config.json": (HF + "config.json", "c3f420e8a5aea41b97f698404a1b1e28e403c662f65927345335fc5493f2e075"),
    "include/onnxruntime_c_api.h": (ORT + "onnxruntime_c_api.h", "71125e66180a991d65c9bdbad4aa20daaa1f7a48c7a5c0fa5f18f250ac839a02"),
    "include/onnxruntime_cxx_api.h": (ORT + "onnxruntime_cxx_api.h", "08ae3698d11d90590a0a777ad97e58172b8735fcbe27edcc8a7b94aa018e5de9"),
    "include/onnxruntime_cxx_inline.h": (ORT + "onnxruntime_cxx_inline.h", "226f883503ade7299f9474018a070dc94091c1541bcc6d419599eea0c2ee578e"),
    "include/onnxruntime_float16.h": (ORT + "onnxruntime_float16.h", "6c4db3d1954b266c4febe413351af86cac922e3448538e7e452e51d646e56a4a"),
    "include/onnxruntime_ep_c_api.h": (ORT + "onnxruntime_ep_c_api.h", "b92778f50c36ecdf53d0344e0129a78b306afed653f81bba8a9597e3e6e9546f"),
    "include/pocketfft_hdronly.h": ("https://raw.githubusercontent.com/mreineck/pocketfft/4d865cba24359b05b37da4e75aee24498c3b78e7/pocketfft_hdronly.h", "518a95c552aeaee352aa30122137cd9e135d23c91e2863d9272aaa758744c86d"),
}


def download(root):
    root = Path(root)
    for name, (url, expected) in ASSETS.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            temporary = path.with_suffix(path.suffix + ".part")
            urllib.request.urlretrieve(url, temporary)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != expected:
                temporary.unlink()
                raise RuntimeError(f"Checksum mismatch: {name}")
            temporary.replace(path)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise RuntimeError(f"Checksum mismatch: {name}")


def verify_optimized(path):
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != OPTIMIZED_SHA256:
        raise RuntimeError("Optimized Paradee artifact is not reproducible.")


if __name__ == "__main__":
    download("/opt/models")
