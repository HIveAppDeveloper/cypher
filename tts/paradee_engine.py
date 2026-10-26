"""Opt-in Paradee 8M v1.1: a single-voice Kokoro derivative, not Kokoro-82M."""
import json
import os
from pathlib import Path
import re

import numpy as np

MODEL_ID = "paradee-8m-v1.1"


def streaming_chunks(text):
    # Give the listener a complete first word, then use sentence-sized chunks.
    # Keep short function words with their following word for intelligibility.
    words = text.strip().split()
    count = 2 if len(words[0].strip(".,!?;:")) < 3 and len(words) > 1 else 1
    yield " ".join(words[:count])
    remaining = " ".join(words[count:])
    while remaining:
        boundary = re.search(r"[.!?;:]\s+", remaining[:181])
        end = boundary.end() if boundary else (len(remaining) if len(remaining) <= 180 else remaining.rfind(" ", 0, 181))
        if end < 1:
            end = remaining.find(" ")
            if end < 1:
                end = len(remaining)
        yield remaining[:end].strip()
        remaining = remaining[end:].strip()


class ParadeeEngine:
    model_id = MODEL_ID
    chunks = staticmethod(streaming_chunks)

    def __init__(self):
        import onnxruntime as ort
        from misaki import en, espeak

        root = Path(os.environ.get("KOKORO_MODEL_DIR", "/opt/models"))
        options = ort.SessionOptions()
        # Performance instances have two vCPUs. An explicit override allows the
        # same image to be measured on Standard instances without oversubscription.
        threads = int(os.environ.get("KOKORO_CPU_THREADS", "2"))
        if threads not in (1, 2):
            raise RuntimeError("KOKORO_CPU_THREADS must be 1 or 2.")
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        options.register_custom_ops_library(str(root / "paradee_fft.so"))
        self.session = ort.InferenceSession(str(root / "paradee_cpu_fft.onnx"), options, providers=["CPUExecutionProvider"])
        self.providers = self.session.get_providers()
        self.vocab = json.loads((root / "paradee-config.json").read_text())["vocab"]
        # The English spaCy model and Misaki dictionaries are baked into the
        # image. Runtime requests never download models or call an inference API.
        self.g2p = en.G2P(trf=False, british=False, fallback=espeak.EspeakFallback(british=False), unk="")
        self.synthesize("Ready.", "af_heart", 1.0)

    def synthesize(self, text, voice, speed):
        if voice != "af_heart":
            raise RuntimeError("Paradee supports only af_heart.")
        from kokoro_service import pcm16
        try:
            phonemes, _ = self.g2p(text)
            ids = [0] + [self.vocab[c] for c in phonemes if c in self.vocab] + [0]
            if len(ids) < 3 or len(ids) > 512:
                raise RuntimeError("Unsupported phoneme length.")
            audio = self.session.run(None, {"input_ids": np.asarray([ids], dtype=np.int64), "speed": np.asarray([speed], dtype=np.float32)})[0][0]
            if not len(audio) or not np.isfinite(audio).all():
                raise RuntimeError("Invalid generated waveform.")
            return pcm16(audio)
        except Exception:
            raise RuntimeError("Voice generation failed.") from None
