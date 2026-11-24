"""Music + sound effects for "Which Armor Will Save Him?".

Reads build/armor/timeline.json (written by armor/export.mjs) and writes build/armor/mix.wav.
Original phonk-style beat at 120 BPM in E minor, synthesized from scratch with audio/synth.py,
plus effects placed on every cue (grabs, throws, impacts, hurt, X stamps, heartbeat, shatter).
"""
import json
import math
import os
import sys

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "audio"))
from synth import (SR, Track, n_of, tt, hz, sine, saw, square, noise, lp, hp, bp, sweep, drive, reverb, stereo, fade,  # noqa: E402
                   kick808, bass808, snare, clap, hat, cowbell, boom, whoosh, riser, rev_cymbal, block_place, pop, bell,
                   chime_gliss, thunder, phase)

T = json.load(open(os.path.join(ROOT, "build", "armor", "timeline.json")))
DUR = T["duration"]
BEAT = 60 / T["bpm"]
STEP = BEAT / 4
R = np.random.default_rng(99)
ROUNDS = T["rounds"]
FINAL = ROUNDS[-1]
SLAM_FINAL = FINAL["start"] + FINAL["hits"][0][0]
SURVIVE = FINAL["start"] + FINAL["survive"]
SHATTER = FINAL["start"] + FINAL["punch"]


# ------------------------------------------------------------------ music
BASS = ["E1", "E1", "C2", "D2"]  # one root per bar, cycling
BELL_RIFF = [  # 16 steps per bar, E minor phonk cowbell
    ["E5", None, "E5", None, "G5", None, "E5", "D5", None, "E5", None, "B4", "D5", None, "E5", None],
    ["E5", None, "E5", None, "G5", None, "A5", None, "G5", None, "E5", None, "D5", "E5", None, None],
    ["C5", None, "C5", None, "E5", None, "C5", "B4", None, "C5", None, "G4", "B4", None, "C5", None],
    ["D5", None, "D5", None, "F#5", None, "A5", None, "F#5", None, "D5", None, "E5", None, "F#5", None],
]


def bar_of(t):
    return int(math.floor(t / (4 * BEAT) + 1e-6))


def beat_section(m, start, end, intensity=1.0, bells=True):
    """Drums, 808 and cowbell riff between start and end (seconds, on the grid)."""
    s = int(round(start / STEP))
    e = int(round(end / STEP))
    for k in range(s, e):
        t = k * STEP
        pos = k % 16
        bar = bar_of(t)
        root = BASS[bar % 4]
        if pos in (0, 10) or (pos == 7 and bar % 2):
            m.add(t, kick808(0.5, 160, 44, decay=0.28), 0.9 * intensity)
            m.add(t, bass808(hz(root) * 2, hz(root), 0.9 if pos == 0 else 0.45), 0.55 * intensity)
        if pos in (4, 12):
            m.add(t, clap(), 0.42 * intensity, 0.0)
            m.add(t, snare(0.25, 200), 0.22 * intensity)
        if pos % 2 == 0 or (pos in (13, 15) and bar % 2 == 0):
            m.add(t, hat(), (0.16 if pos % 4 == 0 else 0.11) * intensity, 0.3)
        if pos == 14 and bar % 2 == 1:
            m.add(t, hat(True), 0.12 * intensity, -0.3)
        if bells:
            nt = BELL_RIFF[bar % 4][pos]
            if nt:
                m.add(t, cowbell(nt, 0.26), 0.3 * intensity, -0.15)


def compose_music():
    m = Track(DUR + 2)
    # hook: riser into the first downbeat, a big hit on the title
    m.add(0.0, riser(2.0, 120, 5000), 0.32)
    m.add(1.0, rev_cymbal(1.0), 0.25)
    m.add(0.0, lp(saw(hz("E1"), 2.0), 300) * np.exp(-tt(2.0) / 1.4), 0.22)
    # rounds 1-6 + the start of the final one, until the final slam
    beat_section(m, ROUNDS[0]["start"], SLAM_FINAL - 0.5, 1.0)
    # the beat drops out for the final slam; a low drone while hearts drain
    drone = lp(saw(hz("E1"), 3.0) + 0.6 * saw(hz("E1") * 1.005, 3.0), 220) * fade(np.ones(n_of(3.0)), 0.4, 0.8)
    m.add(SLAM_FINAL + 0.2, drone, 0.25)
    # survive: triumphant swell, then the beat comes back harder for the punch and the ending
    m.add(SURVIVE, chime_gliss(["E5", "G5", "B5", "E6", "G6", "B6"], 0.05), 0.45)
    m.add(SURVIVE - 0.9, riser(0.9, 300, 7000), 0.25)
    beat_section(m, SHATTER - 2 * BEAT, DUR, 1.1)
    m.add(SHATTER, hp(noise(2.0), 4000) * np.exp(-tt(2.0) / 0.5), 0.12)  # crash
    return m.buf


# ------------------------------------------------------------------ effects
def crumble(sec=0.8, density=90, kind="dirt", pitch=1.0):
    """Lots of tiny debris clicks spread over time, thinning out."""
    out = np.zeros(n_of(sec + 0.2))
    for _ in range(density):
        a = R.random() ** 2 * sec
        s = block_place(kind, pitch * (0.7 + R.random() * 0.8)) * (0.25 + R.random() * 0.5) * (1 - a / sec) ** 0.5
        i = n_of(a)
        out[i:i + len(s)] += s[: len(out) - i]
    return out


def growl(sec=1.3, f0=62):
    t = tt(sec)
    f = f0 * (1 + 0.15 * np.sin(2 * np.pi * 7 * t) + 0.25 * np.exp(-t * 3)) * (1 - 0.2 * t / sec)
    x = saw(f, sec) + 0.7 * saw(f * 1.51, sec) + 0.5 * square(f * 0.5, sec)
    x = bp(x, 80, 900)
    rasp = bp(noise(sec), 300, 1800) * (0.5 + 0.5 * np.sin(2 * np.pi * 31 * t))
    env = np.minimum(1, t / 0.12) * np.exp(-np.maximum(0, t - sec * 0.6) / 0.25)
    return drive((x * 0.8 + rasp * 0.5) * env, 2.5) * 0.7


def hurt(lethal=False):
    """Synthetic 'oof': a short vowel-ish pitch drop."""
    sec = 0.28
    t = tt(sec)
    f = 330 * np.exp(-t * 4) + 140
    x = saw(f, sec)
    x = bp(x, 500, 1500) * 0.9 + bp(x, 1800, 2800) * 0.3
    x *= np.minimum(1, t / 0.01) * np.exp(-t / 0.09)
    if lethal:
        sp = lp(noise(0.35), 900) * np.exp(-tt(0.35) / 0.07) * 0.9  # wet splat
        sp += bp(noise(0.35), 200, 600) * np.exp(-tt(0.35) / 0.12) * 0.6
        out = np.zeros(n_of(0.4))
        out[: len(x)] += x
        out[: len(sp)] += sp
        return out
    return x


def buzzer(sec=0.32):
    t = tt(sec)
    x = square(110, sec, 0.4) + square(116.5, sec, 0.4) + 0.5 * square(220, sec, 0.3)
    return lp(x, 2400) * np.minimum(1, t / 0.005) * np.exp(-np.maximum(0, t - 0.22) / 0.03) * 0.35


def thud(sec=0.25, f=70):
    t = tt(sec)
    return np.sin(phase(f * (1 + 2 * np.exp(-t * 30)), len(t))) * np.exp(-t / 0.07) + lp(noise(sec), 500) * np.exp(-t / 0.03) * 0.5


def heartbeat():
    out = np.zeros(n_of(0.5))
    for a, g in ((0.0, 1.0), (0.17, 0.7)):
        s = thud(0.22, 52) * g
        i = n_of(a)
        out[i:i + len(s)] += s
    return lp(out, 300)


def impact(strength, stone):
    sec = 2.2
    x = np.zeros(n_of(sec))
    b = boom(1.6, 110, 30) * (0.6 + 0.4 * strength)
    x[: len(b)] += b
    c = crumble(0.7 + 0.3 * strength, int(60 + 60 * strength), "stone" if stone else "dirt")
    x[: len(c)] += c * 0.7
    cr = hp(noise(0.2), 1500) * np.exp(-tt(0.2) / 0.02) * 0.6
    x[: len(cr)] += cr
    if strength > 1.2:
        th = thunder(2.0, 0.6) * 0.5
        x[: len(th)] += th
    return x


def compose_sfx():
    s = Track(DUR + 2)
    for e in T["events"]:
        t, ty = e["t"], e["type"]
        pan = (R.random() - 0.5) * 0.4
        if ty == "title":
            s.add(t, boom(1.8, 120, 34), 0.7)
            s.add(t, hp(noise(0.6), 3000) * np.exp(-tt(0.6) / 0.12), 0.18)
        elif ty == "roar":
            s.add(t, reverb(growl(1.4 if t < 5 else 1.0), 1.6, 3000, 0.35), 0.55)
        elif ty == "round":
            s.add(t, pop(500, 1300, 0.08), 0.25)
            s.add(t, whoosh(0.35, 800, 5000), 0.18)
        elif ty == "land":
            s.add(t, thud(0.3, 75), 0.5)
            s.add(t, crumble(0.25, 14, "dirt"), 0.35)
            s.add(t, block_place("metal", 0.8), 0.12)  # armour clank
        elif ty == "grab":
            s.add(t, block_place("stone", 0.6), 0.6)
            s.add(t, thud(0.2, 90), 0.45)
            s.add(t, block_place("metal", 0.7), 0.2)
        elif ty == "whoosh":
            big = e.get("big")
            s.add(t - 0.05, whoosh(0.55 if big else 0.4, 250, 3000 if big else 4500), 0.55 if big else 0.4, pan)
        elif ty == "step":
            s.add(t, thud(0.4, 48), 0.6)
        elif ty == "run":
            for k in range(7):
                s.add(t + 0.25 + k * 0.13, block_place("dirt", 1.6), 0.18, -0.2 + 0.1 * (k % 2))
        elif ty == "impact":
            s.add(t, impact(e["strength"], e.get("onStone")), 0.85)
        elif ty == "hurt":
            s.add(t + 0.02, hurt(e.get("lethal")), 0.42)
        elif ty == "xmark":
            s.add(t, buzzer(), 0.5)
        elif ty == "heartbeat":
            s.add(t, heartbeat(), 0.8)
        elif ty == "survive":
            s.add(t, bell("E6", 1.5, 2.0, 1.0), 0.35)
        elif ty == "jump":
            s.add(t, pop(200, 700, 0.14), 0.4)
            s.add(t, whoosh(0.3, 600, 5000), 0.3)
        elif ty == "shatter":
            s.add(t, impact(1.6, True), 1.0)
            s.add(t, crumble(2.2, 420, "stone", 0.9), 0.7)
            s.add(t + 0.05, crumble(1.5, 120, "glass", 1.0), 0.25)
            s.add(t, reverb(growl(0.5, 90), 1.2, 3000, 0.3), 0.3)
        elif ty == "ask":
            s.add(t, pop(600, 1400, 0.08), 0.3)
            s.add(t + 0.12, pop(700, 1600, 0.08), 0.25)
    return s.buf


# ------------------------------------------------------------------ mix
def duck_curve(n, times, depth=0.6, hold=0.12, rel=0.45):
    g = np.ones(n)
    for t in times:
        i = n_of(t)
        a, b = i, min(n, i + n_of(hold + rel))
        if a >= n:
            continue
        k = np.arange(b - a) / SR
        curve = np.where(k < hold, 1 - depth, 1 - depth * np.exp(-(k - hold) / (rel / 3)))
        g[a:b] = np.minimum(g[a:b], curve)
    return g


def limit(x, ceiling=0.89, lookahead=0.005, release=0.08):
    from scipy.ndimage import minimum_filter1d
    peak = np.abs(x).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    la = n_of(lookahead)
    g = minimum_filter1d(need, size=2 * la + 1, mode="nearest")
    r = math.exp(-1 / (release * SR))
    out = np.empty_like(g)
    level = 1.0
    blk = 32
    for i in range(0, len(g), blk):
        m = g[i:i + blk].min()
        level = m if m < level else r ** blk * level + (1 - r ** blk) * m
        out[i:i + blk] = np.minimum(level, g[i:i + blk])
    return x * out[:, None]


def main():
    music = compose_music()
    sfx = compose_sfx()
    n = n_of(DUR)
    music, sfx = music[:n], sfx[:n]
    hits = [e["t"] for e in T["events"] if e["type"] in ("impact", "shatter")]
    music *= duck_curve(n, hits, 0.65)[:, None]
    mix = music * 0.8 + sfx
    mix = hp(mix, 25)
    mix = mix / (np.abs(mix).max() + 1e-9) * 2.1  # push into the limiter for loudness
    mix = limit(mix, 0.83)
    mix = fade(mix, 0.0, 0.35)
    out = os.path.join(ROOT, "build", "armor", "mix.wav")
    sf.write(out, mix.astype(np.float32), SR, subtype="FLOAT")
    print(f"wrote {out}  ({DUR:.1f}s)")


if __name__ == "__main__":
    main()
