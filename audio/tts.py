"""Generate the voiceover with Kokoro and time every caption word.

Writes build/vo/<id>.wav (48 kHz mono) and build/vo/lines.json.
Each line is transcribed back with ASR: the transcript is checked against the
script and its word onsets become the caption timings.
"""
import difflib
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from kokoro_onnx import Kokoro

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asr import recognizer  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build", "vo")
SR = 24000
# ASR spellings of words it does not know
SOUNDS_LIKE = {"NOOB": "NEW"}


def trim(x, db=-42.0, pad=0.03):
    env = np.abs(x)
    thr = env.max() * 10 ** (db / 20)
    idx = np.where(env > thr)[0]
    a = max(0, idx[0] - int(pad * SR))
    b = min(len(x), idx[-1] + int(pad * SR))
    return x[a:b]


def asr_words(audio):
    """[(WORD, onset_seconds)] from the transducer's token timestamps."""
    x = resample_poly(audio, 2, 3).astype(np.float32)  # 24k -> 16k
    pad = np.zeros(4000, dtype=np.float32)
    rec = recognizer()
    s = rec.create_stream()
    s.accept_waveform(16000, np.concatenate([pad, x, pad]))
    rec.decode_stream(s)
    words = []
    for tok, ts in zip(s.result.tokens, s.result.timestamps):
        if tok.startswith(" ") or not words:
            words.append([tok.strip(), max(0.0, ts - 0.25)])
        else:
            words[-1][0] += tok
    return s.result.text.strip(), words


def norm(w):
    w = re.sub(r"[^A-Za-z]", "", w).upper()
    return SOUNDS_LIKE.get(w, w)


def main():
    script = json.load(open(os.path.join(ROOT, "script.json")))
    os.makedirs(OUT, exist_ok=True)
    k = Kokoro(os.path.join(ROOT, "models", "kokoro-v1.0.onnx"),
               os.path.join(ROOT, "models", "voices-v1.0.bin"))
    result = []
    for line in script["lines"]:
        audio, sr = k.create(line["text"], voice=script["voice"],
                             speed=line.get("speed", 1.0), lang="en-us")
        assert sr == SR
        audio = trim(np.asarray(audio, dtype=np.float32))
        dur = len(audio) / SR

        cap_words = line["caption"].split()
        text, heard = asr_words(audio)
        want = [norm(w) for w in cap_words]
        got = [norm(w) for w, _ in heard]
        # ASR may split a word ("HALLOW EEN"): merge pieces that rebuild a script word
        merged = []
        i = 0
        while i < len(heard):
            w, t = got[i], heard[i][1]
            j = i + 1
            while j < len(heard) and w not in want and any(x.startswith(w + got[j]) for x in want):
                w += got[j]
                j += 1
            merged.append((w, t))
            i = j
        sm = difflib.SequenceMatcher(a=want, b=[w for w, _ in merged], autojunk=False)
        starts = [None] * len(want)
        for blk in sm.get_matching_blocks():
            for n in range(blk.size):
                starts[blk.a + n] = merged[blk.b + n][1]
        ratio = sm.ratio()
        # fill gaps by interpolating on word length
        starts[0] = 0.0 if starts[0] is None else starts[0]
        known = [i for i, s in enumerate(starts) if s is not None] + [len(want)]
        ends_at = dur - 0.05
        for a, b in zip(known, known[1:]):
            tb = starts[b] if b < len(want) else ends_at
            if b - a > 1:
                lens = [max(len(want[i]), 2) for i in range(a, b)]
                acc = starts[a]
                span = tb - starts[a]
                for i in range(a + 1, b):
                    acc += span * lens[i - a - 1] / sum(lens)
                    starts[i] = acc
        timings = []
        for i, s in enumerate(starts):
            e = starts[i + 1] if i + 1 < len(starts) else dur
            timings.append({"w": cap_words[i], "start": round(s, 3), "end": round(e, 3)})

        out48 = resample_poly(audio, 2, 1).astype(np.float32)
        path = os.path.join(OUT, f"{line['id']}.wav")
        sf.write(path, out48, 48000)
        result.append({"id": line["id"], "file": os.path.relpath(path, ROOT),
                       "duration": round(dur, 3), "asr": text, "match": round(ratio, 2),
                       "words": timings})
        flag = "" if ratio >= 0.8 else "   <-- CHECK"
        print(f"{line['id']:7s} {dur:4.2f}s match={ratio:.2f} heard='{text}'{flag}")
        print("        " + " ".join(f"{t['w']}@{t['start']:.2f}" for t in timings))
    json.dump(result, open(os.path.join(OUT, "lines.json"), "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
