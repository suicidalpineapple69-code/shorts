"""Small synthesis toolkit: oscillators, envelopes, filters, effects, instruments.

Everything is generated from scratch with numpy/scipy at 48 kHz.
Mono signals are 1-D float arrays; stereo signals are (n, 2).
"""
import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi, fftconvolve

SR = 48000
RNG = np.random.default_rng(7)


def n_of(sec):
    return max(1, int(round(sec * SR)))


def tt(sec):
    return np.arange(n_of(sec)) / SR


def midi(note):
    """'D4' / 'C#5' / 'Bb2' -> MIDI number."""
    names = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
    base = names[note[0]]
    rest = note[1:]
    if rest[0] == "#":
        base += 1
        rest = rest[1:]
    elif rest[0] == "b":
        base -= 1
        rest = rest[1:]
    return base + 12 * (int(rest) + 1)


def hz(note):
    m = note if isinstance(note, (int, float)) else midi(note)
    return 440.0 * 2 ** ((m - 69) / 12)


# ---------------------------------------------------------------- oscillators

def phase(freq, n):
    """Integrated phase for a constant or per-sample frequency."""
    f = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    return 2 * np.pi * np.cumsum(f) / SR


def sine(freq, sec):
    n = n_of(sec)
    return np.sin(phase(freq, n))


def saw(freq, sec):
    n = n_of(sec)
    p = phase(freq, n) / (2 * np.pi)
    return 2 * (p - np.floor(p + 0.5))


def square(freq, sec, duty=0.5):
    n = n_of(sec)
    p = phase(freq, n) / (2 * np.pi)
    return np.where((p % 1.0) < duty, 1.0, -1.0)


def noise(sec):
    return RNG.standard_normal(n_of(sec))


# ------------------------------------------------------------------ envelopes

def env_exp(sec, decay, attack=0.002):
    t = tt(sec)
    e = np.exp(-t / decay)
    a = n_of(attack)
    e[:a] *= np.linspace(0, 1, a)
    return e


def env_adsr(sec, a=0.01, d=0.1, s=0.7, r=0.1):
    n = n_of(sec)
    e = np.full(n, s, dtype=np.float64)
    na, nd, nr = n_of(a), n_of(d), n_of(r)
    na = min(na, n)
    e[:na] = np.linspace(0, 1, na)
    nd = min(nd, n - na)
    e[na:na + nd] = np.linspace(1, s, nd)
    nr = min(nr, n)
    e[n - nr:] *= np.linspace(1, 0, nr)
    return e


# -------------------------------------------------------------------- filters

def _sos(kind, f, q=0.707, order=2):
    nyq = SR / 2
    if kind == "band":
        lo, hi = f
        return butter(order, [max(lo, 10) / nyq, min(hi, nyq * 0.99) / nyq], btype="band", output="sos")
    return butter(order, min(max(f, 10), nyq * 0.99) / nyq, btype=kind, output="sos")


def lp(x, f, order=2):
    return sosfilt(_sos("low", f, order=order), x, axis=0)


def hp(x, f, order=2):
    return sosfilt(_sos("high", f, order=order), x, axis=0)


def bp(x, lo, hi, order=2):
    return sosfilt(_sos("band", (lo, hi), order=order), x, axis=0)


def sweep(x, kind, f0, f1, block=256, curve="exp", width=1.0):
    """Time-varying filter (lowpass/highpass/band) swept from f0 to f1."""
    if x.ndim == 2:
        return np.stack([sweep(x[:, c], kind, f0, f1, block, curve, width) for c in range(x.shape[1])], axis=1)
    n = len(x)
    out = np.zeros_like(x)
    nb = (n + block - 1) // block
    zi = None
    for i in range(nb):
        u = i / max(1, nb - 1)
        f = f0 * (f1 / f0) ** u if curve == "exp" else f0 + (f1 - f0) * u
        if kind == "band":
            sos = _sos("band", (f / (1 + width), f * (1 + width)))
        else:
            sos = _sos(kind, f)
        if zi is None:
            zi = sosfilt_zi(sos) * 0
        seg = x[i * block:(i + 1) * block]
        y, zi = sosfilt(sos, seg, zi=zi)
        out[i * block:(i + 1) * block] = y
    return out


# -------------------------------------------------------------------- effects

def drive(x, amount):
    return np.tanh(amount * x) / np.tanh(amount)


def crush(x, bits=6, hold=4):
    q = 2 ** bits
    y = np.round(x * q) / q
    return np.repeat(y[::hold], hold)[: len(x)]


def stereo(x, pan=0.0, width=0.0):
    """Mono -> stereo with constant-power pan (-1..1); width adds a short delay."""
    a = (pan + 1) * np.pi / 4
    l, r = np.cos(a) * x, np.sin(a) * x
    if width:
        d = n_of(0.012 * width)
        r = np.concatenate([np.zeros(d), r[:-d]]) if d < len(r) else r
    return np.stack([l, r], axis=1)


_IR = {}


def reverb(x, size=1.8, damp=4000, mix=0.3, predelay=0.012):
    """Convolution reverb with a synthetic decaying-noise impulse response."""
    key = (size, damp, predelay)
    if key not in _IR:
        r = np.random.default_rng(11)
        n = n_of(size)
        t = np.arange(n) / SR
        ir = r.standard_normal((n, 2)) * np.exp(-t * 6.9 / size)[:, None]
        ir = lp(ir, damp)
        ir[: n_of(0.004)] *= np.linspace(0, 1, n_of(0.004))[:, None]
        ir = np.concatenate([np.zeros((n_of(predelay), 2)), ir])
        ir /= np.sqrt(np.sum(ir ** 2) / 2)
        _IR[key] = ir
    ir = _IR[key]
    if x.ndim == 1:
        x = np.stack([x, x], axis=1)
    wet = np.stack([fftconvolve(x[:, c], ir[:, c]) for c in range(2)], axis=1)[: len(x) + len(ir) - 1]
    dry = np.concatenate([x, np.zeros((len(wet) - len(x), 2))])
    return dry * (1 - mix) + wet * mix * 0.35


def fade(x, fin=0.0, fout=0.0):
    x = x.copy()
    a, b = n_of(fin) if fin else 0, n_of(fout) if fout else 0
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] if x.ndim == 2 else np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] if x.ndim == 2 else np.linspace(1, 0, b)
    return x


# --------------------------------------------------------------- the canvas

class Track:
    """A stereo buffer that sounds are mixed into at given times."""

    def __init__(self, sec):
        self.buf = np.zeros((n_of(sec), 2))

    def add(self, at, sig, gain=1.0, pan=0.0):
        if sig.ndim == 1:
            sig = stereo(sig, pan)
        i = n_of(at) if at > 0 else 0
        if at < 0:
            sig = sig[n_of(-at):]
        j = min(len(self.buf), i + len(sig))
        if j > i:
            self.buf[i:j] += sig[: j - i] * gain


# ---------------------------------------------------------------- instruments

def kick808(sec=0.6, f_hi=150, f_lo=46, punch=28, decay=0.32, click=0.5):
    t = tt(sec)
    f = f_lo + (f_hi - f_lo) * np.exp(-t * punch)
    x = np.sin(phase(f, len(t))) * np.exp(-t / decay)
    c = hp(noise(0.006), 2500) * click
    x[: len(c)] += c * np.linspace(1, 0, len(c))
    return drive(x, 1.6)


def bass808(f_start, f_end, sec, glide=0.06, decay=0.9, amount=2.4):
    t = tt(sec)
    f = f_end + (f_start - f_end) * np.exp(-t / max(glide, 1e-4) * 3)
    x = np.sin(phase(f, len(t)))
    e = np.exp(-t / decay)
    e[: n_of(0.004)] *= np.linspace(0, 1, n_of(0.004))
    rel = n_of(0.03)
    e[-rel:] *= np.linspace(1, 0, rel)
    return drive(x * e, amount) * 0.8


def snare(sec=0.35, tone=190):
    t = tt(sec)
    body = np.sin(phase(tone * (1 + 0.5 * np.exp(-t * 60)), len(t))) * np.exp(-t / 0.05)
    nz = bp(noise(sec), 1200, 8000) * np.exp(-t / 0.11)
    return drive(body * 0.6 + nz * 0.9, 1.3)


def clap(sec=0.4):
    t = tt(sec)
    x = np.zeros(len(t))
    for k, d in enumerate([0.0, 0.011, 0.023, 0.034]):
        i = n_of(d)
        seg = bp(noise(sec - d), 900, 5000) * np.exp(-tt(sec - d) / (0.012 if k < 3 else 0.13))
        seg = seg[: len(x) - i]
        x[i:i + len(seg)] += seg
    return x * 0.7


def hat(open_=False, sec=None):
    sec = sec or (0.32 if open_ else 0.05)
    t = tt(sec)
    x = hp(noise(sec), 7000, order=4) * np.exp(-t / (0.11 if open_ else 0.014))
    metal = sum(square(f, sec) for f in (3150, 4670, 5810, 7320)) * 0.05
    return (x + hp(metal, 6000) * np.exp(-t / (0.08 if open_ else 0.012))) * 0.6


def cowbell(note, sec=0.32):
    """Pitched 808-style cowbell (the phonk lead)."""
    f = hz(note)
    t = tt(sec)
    x = square(f, sec, 0.5) + square(f * 1.4818, sec, 0.5)
    x = bp(x, f * 0.9, f * 4.5)
    e = np.exp(-t / 0.075) * 0.75 + np.exp(-t / 0.28) * 0.25
    e[: n_of(0.002)] *= np.linspace(0, 1, n_of(0.002))
    return drive(x * e, 1.4) * 0.55


def musicbox(note, sec=1.2, bright=1.0):
    f = hz(note)
    t = tt(sec)
    x = (np.sin(phase(f, len(t))) * np.exp(-t / 0.55)
         + 0.35 * np.sin(phase(2 * f, len(t))) * np.exp(-t / 0.25)
         + 0.22 * bright * np.sin(phase(4.16 * f, len(t))) * np.exp(-t / 0.09)
         + 0.08 * bright * np.sin(phase(6.9 * f, len(t))) * np.exp(-t / 0.04))
    x[: n_of(0.002)] *= np.linspace(0, 1, n_of(0.002))
    return x * 0.5


def pluck(note, sec=0.5, damping=0.996, bright=0.6):
    """Karplus-Strong plucked string (pizzicato)."""
    f = hz(note)
    period = int(round(SR / f))
    n = n_of(sec)
    y = np.zeros(n + period)
    y[:period] = lp(RNG.uniform(-1, 1, period), 1500 + 6000 * bright)
    k = period
    while k < n + period:
        prev = y[k - period:k]
        nxt = np.concatenate([prev[1:], prev[-1:]])
        m = min(period, n + period - k)
        y[k:k + m] = (damping * 0.5 * (prev + nxt))[:m]
        k += period
    x = y[period:period + n]
    x *= np.exp(-tt(sec) / (sec * 0.45))
    return x * 0.9


def tuba(note, sec=0.3):
    f = hz(note)
    t = tt(sec)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5 * t)
    x = saw(f * vib, sec) * 0.6 + square(f * vib, sec, 0.35) * 0.4
    x = lp(x, 900) * env_adsr(sec, 0.012, 0.08, 0.6, 0.06)
    return drive(x, 1.5) * 0.5


def organ(notes, sec, attack=0.03, release=0.25, bright=1.0, vibrato=0.0):
    """Pipe-organ chord: additive harmonics per note, slight chorus."""
    t = tt(sec)
    x = np.zeros(len(t))
    for note in notes:
        f = hz(note)
        v = 1 + vibrato * np.sin(2 * np.pi * 5.5 * t)
        for h, a in ((0.5, 0.5), (1, 1.0), (2, 0.55 * bright), (3, 0.28 * bright), (4, 0.22 * bright), (6, 0.1 * bright), (8, 0.06 * bright)):
            if f * h > SR / 2 - 2000:
                continue
            x += a * np.sin(phase(f * h * v * (1 + 0.0007 * h), len(t)))
    x *= env_adsr(sec, attack, 0.05, 0.9, release)
    return x / (len(notes) * 3)


def pad(notes, sec, cutoff=1400, attack=0.4, release=0.6, vowel=True):
    """Detuned-saw choir/pad."""
    t = tt(sec)
    x = np.zeros(len(t))
    for note in notes:
        f = hz(note)
        for d in (-0.11, 0.0, 0.12):
            x += saw(f * 2 ** (d / 12) * (1 + 0.002 * np.sin(2 * np.pi * (0.3 + d) * t)), sec)
    x = lp(x, cutoff)
    if vowel:  # rough "ah" formants
        x = bp(x, 600, 820) * 1.2 + bp(x, 1100, 1350) * 0.8 + x * 0.25
    x *= env_adsr(sec, attack, 0.2, 0.9, release)
    return x / (len(notes) * 2.5)


def theremin(notes, sec_each, glide=0.08, vib=0.012):
    """Sine lead with portamento and wide vibrato, notes as (note, beats)."""
    freqs = []
    for note, dur in zip(notes, sec_each):
        freqs.append(np.full(n_of(dur), hz(note)))
    f = np.concatenate(freqs)
    k = max(1, n_of(glide))
    f = np.convolve(np.concatenate([np.full(k, f[0]), f]), np.ones(k) / k, mode="valid")[: len(f)]
    t = np.arange(len(f)) / SR
    f = f * (1 + vib * np.sin(2 * np.pi * 5.8 * t) * np.clip(t * 3, 0, 1))
    x = np.sin(phase(f, len(f))) + 0.18 * np.sin(2 * phase(f, len(f)))
    return x * env_adsr(len(f) / SR, 0.08, 0.1, 0.9, 0.2) * 0.45


# --------------------------------------------------------------------- sfx

def thunder(sec=3.2, crack=1.0):
    t = tt(sec)
    brown = np.cumsum(RNG.standard_normal(len(t)))
    brown = hp(brown - np.convolve(brown, np.ones(4800) / 4800, mode="same"), 25)
    brown /= np.max(np.abs(brown)) + 1e-9
    mod = lp(np.abs(RNG.standard_normal(len(t))), 6)
    mod /= mod.max()
    rumble = lp(brown, 260) * (0.5 + mod) * np.exp(-t / 1.1)
    c = hp(noise(0.25), 900) * np.exp(-tt(0.25) / 0.035) * crack
    x = rumble * 1.4
    x[: len(c)] += c
    return x


def boom(sec=1.8, f_hi=90, f_lo=32):
    t = tt(sec)
    f = f_lo + (f_hi - f_lo) * np.exp(-t * 4)
    x = np.sin(phase(f, len(t))) * np.exp(-t / 0.55)
    x += lp(noise(sec), 400) * np.exp(-t / 0.18) * 0.6
    return drive(x, 2.0)


def whoosh(sec=0.45, f0=400, f1=4000, peak=0.6):
    t = tt(sec)
    up = sweep(noise(sec), "band", f0, f1, width=0.6)
    e = np.sin(np.pi * np.clip(t / sec, 0, 1)) ** 2
    shift = np.clip((t / sec - peak) * 3, -1, 1)
    return up * e * (1 - 0.3 * shift)


def riser(sec=2.0, f0=200, f1=6000):
    t = tt(sec)
    x = sweep(noise(sec), "band", f0, f1, width=0.4) * 0.8
    tone = saw(np.geomspace(110, 880, len(t)), sec) * 0.18
    return (x + lp(tone, 3000)) * (t / sec) ** 2


def rev_cymbal(sec=1.2):
    t = tt(sec)
    x = hp(noise(sec), 5000) * np.exp(-(sec - t) / 0.35)
    return x * 0.7


def block_place(kind="dirt", pitch=1.0):
    sec = 0.12
    t = tt(sec)
    if kind == "stone":
        x = bp(noise(sec), 1200 * pitch, 5200 * pitch) * np.exp(-t / 0.018) * 0.9
        x += np.sin(phase(260 * pitch, len(t))) * np.exp(-t / 0.02) * 0.5
    elif kind == "wood":
        x = (np.sin(phase(330 * pitch, len(t))) + 0.5 * np.sin(phase(710 * pitch, len(t)))) * np.exp(-t / 0.035)
        x += bp(noise(sec), 600, 3000) * np.exp(-t / 0.012) * 0.5
    elif kind == "glass":
        x = sum(np.sin(phase(f * pitch, len(t))) * np.exp(-t / d) for f, d in ((2300, 0.06), (3550, 0.04), (5200, 0.03))) * 0.35
        x += hp(noise(sec), 4000) * np.exp(-t / 0.01) * 0.4
    elif kind == "metal":
        x = sum(np.sin(phase(f * pitch, len(t))) * np.exp(-t / 0.05) for f in (1650, 2470, 3900)) * 0.3
    else:  # dirt / grass: soft crunch and thump
        x = bp(noise(sec), 350 * pitch, 1700 * pitch) * np.exp(-t / 0.03) * 1.1
        x += np.sin(phase(120 * pitch * (1 + np.exp(-t * 40)), len(t))) * np.exp(-t / 0.035) * 0.8
    x[: n_of(0.001)] *= np.linspace(0, 1, n_of(0.001))
    return x


def pop(f0=420, f1=980, sec=0.09):
    t = tt(sec)
    return np.sin(phase(np.geomspace(f0, f1, len(t)), len(t))) * np.exp(-t / 0.03)


def bloop(sec=0.35):
    """Cartoon plop: a downward pitch drop with a wobble."""
    t = tt(sec)
    f = 520 * np.exp(-t * 7) + 110 + 25 * np.sin(2 * np.pi * 16 * t) * np.exp(-t * 6)
    return np.sin(phase(f, len(t))) * np.exp(-t / 0.12)


def bell(note, sec=1.6, ratio=3.5, index=2.2):
    f = hz(note)
    t = tt(sec)
    mod = np.sin(phase(f * ratio, len(t))) * index * np.exp(-t / 0.4)
    x = np.sin(phase(f, len(t)) + mod) * np.exp(-t / 0.6)
    return x * 0.45


def chime_gliss(notes, step=0.045):
    sec = step * len(notes) + 1.2
    out = np.zeros(n_of(sec))
    for i, nt in enumerate(notes):
        b = bell(nt, 1.0, ratio=2.0, index=1.2) * (0.6 + 0.4 * i / len(notes))
        a = n_of(i * step)
        out[a:a + len(b)] += b[: len(out) - a]
    return out


def key_click(heavy=False):
    sec = 0.05 if not heavy else 0.09
    t = tt(sec)
    x = bp(noise(sec), 1800, 7000) * np.exp(-t / (0.004 if not heavy else 0.008))
    x += np.sin(phase(1900 if not heavy else 520, len(t))) * np.exp(-t / (0.006 if not heavy else 0.02)) * (0.3 if not heavy else 0.8)
    return x


def glitch(sec=0.35):
    t = tt(sec)
    x = crush(square(np.where((t * 23) % 1 < 0.5, 180, 1320), sec, 0.3) * 0.5 + noise(sec) * 0.4, bits=3, hold=12)
    gate = (np.floor(t * 28) % 3 != 1).astype(float)
    return x * gate * np.exp(-t / 0.15)


def fwoom(sec=0.7):
    t = tt(sec)
    x = sweep(noise(sec), "low", 150, 4000) * np.sin(np.pi * np.clip(t / sec, 0, 1)) ** 0.7
    return x * 0.9


def cricket(sec, f=4400, rate=0.42, seed=1):
    r = np.random.default_rng(seed)
    t = tt(sec)
    x = np.zeros(len(t))
    k = r.uniform(0, rate)
    while k < sec - 0.12:
        for p in range(3):
            a = n_of(k + p * 0.033)
            seg = np.sin(phase(f * r.uniform(0.99, 1.01), n_of(0.024))) * np.sin(np.linspace(0, np.pi, n_of(0.024)))
            x[a:a + len(seg)] += seg
        k += rate * r.uniform(0.85, 1.15)
    return x * 0.25


def squeak(sec=0.06):
    t = tt(sec)
    return np.sin(phase(np.linspace(7800, 5600, len(t)), len(t))) * np.sin(np.linspace(0, np.pi, len(t))) * 0.3


def wind(sec):
    t = tt(sec)
    x = sweep(noise(sec), "band", 300, 300, width=0.8)
    m = 0.6 + 0.4 * np.sin(2 * np.pi * 0.13 * t) * np.sin(2 * np.pi * 0.07 * t + 1)
    return x * m * 0.25
