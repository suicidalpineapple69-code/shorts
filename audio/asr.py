"""Speech recognition used to QA the voiceover and to time captions per word."""
import os

import numpy as np
import sherpa_onnx
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_M = os.path.join(ROOT, "models", "asr", "sherpa-onnx-zipformer-small-en-2023-06-26")
_rec = None


def recognizer():
    global _rec
    if _rec is None:
        _rec = sherpa_onnx.OfflineRecognizer.from_transducer(
            encoder=os.path.join(_M, "encoder-epoch-99-avg-1.onnx"),
            decoder=os.path.join(_M, "decoder-epoch-99-avg-1.onnx"),
            joiner=os.path.join(_M, "joiner-epoch-99-avg-1.onnx"),
            tokens=os.path.join(_M, "tokens.txt"),
            num_threads=4,
            decoding_method="modified_beam_search",
        )
    return _rec


def transcribe(audio, sr):
    """Return (text, [(word, start_seconds)]) for a mono float waveform."""
    x = np.asarray(audio, dtype=np.float32)
    if sr != 16000:
        g = np.gcd(sr, 16000)
        x = resample_poly(x, 16000 // g, sr // g).astype(np.float32)
    # a little silence on both sides helps the model with the first/last word
    pad = np.zeros(int(0.25 * 16000), dtype=np.float32)
    x = np.concatenate([pad, x, pad])
    rec = recognizer()
    s = rec.create_stream()
    s.accept_waveform(16000, x)
    rec.decode_stream(s)
    words = []
    for tok, ts in zip(s.result.tokens, s.result.timestamps):
        if tok.startswith("▁") or not words:
            words.append([tok.lstrip("▁"), ts - 0.25])
        else:
            words[-1][0] += tok
    return s.result.text.strip(), [(w, round(t, 3)) for w, t in words if w]
