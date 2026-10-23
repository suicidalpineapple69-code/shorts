"""Score, sound design and mix for the short.

Reads build/timeline.json, build/events.json and the voiceover, and writes
build/music.wav, build/sfx.wav, build/vo.wav and the final build/mix.wav.
Original music: 120 BPM in D minor, Halloween-phonk flavour.
"""
import json
import math
import os
import sys

import numpy as np
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from synth import (  # noqa: E402
    SR, Track, bass808, bell, block_place, bloop, boom, chime_gliss, clap, cowbell, cricket, crush, drive, fade, fwoom,
    glitch, hat, hz, key_click, kick808, lp, hp, musicbox, n_of, noise, organ, pad, pluck, pop, rev_cymbal, reverb,
    riser, snare, squeak, sweep, thunder, tt, tuba, whoosh, wind,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, "build", "timeline.json")))
EV = json.load(open(os.path.join(ROOT, "build", "events.json")))
S, E = T["sections"], T["events"]
DUR = T["duration"]
BEAT = 60 / T["bpm"]
STEP = BEAT / 4
R = np.random.default_rng(2024)

CHORDS = {
    "Dm": ["D3", "F3", "A3", "D4"],
    "Bb": ["Bb2", "D3", "F3", "Bb3"],
    "Gm": ["G2", "Bb2", "D3", "G3"],
    "A": ["A2", "C#3", "E3", "A3"],
}


# ------------------------------------------------------------------- music

def hook(m):
    m.add(0.0, reverb(organ(CHORDS["Dm"] + ["A4"], 1.9, attack=0.01, release=0.9, bright=1.2), size=2.6, mix=0.45), 0.55)
    m.add(0.0, boom(2.0), 0.5)
    arp = ["A5", "D6", "F6", "E6", "D6", "A5", "F5", "A5", "Bb5", "D6"]
    box = Track(3.0)
    for i, nt in enumerate(arp):
        box.add(i * BEAT / 2, musicbox(nt, 1.0), 0.9 if i % 4 == 0 else 0.65, pan=0.25 * math.sin(i))
    m.add(0.0, reverb(box.buf, size=1.6, mix=0.35), 0.75)
    for b in range(5):
        if b % 2 == 0:
            m.add(b * BEAT, kick808(0.4, 110, 45, 20, 0.12, 0.1), 0.45)
            m.add(b * BEAT + 0.2, kick808(0.4, 100, 42, 20, 0.1, 0.05), 0.3)
    m.add(0.0, fade(lp(pad(["D2", "A2"], 2.5, cutoff=500, attack=0.3, release=0.3, vowel=False), 400), 0, 0.2), 0.5)


def rewind(m, music_so_far):
    a, b = S["rewind"]
    src = music_so_far[: n_of(a)][::-1]
    n = n_of(b - a)
    # play the hook backwards, five times faster, warbling like a tape
    pos = np.linspace(0, len(src) - 1, n) + 900 * np.sin(np.linspace(0, 9 * np.pi, n))
    pos = np.clip(pos, 0, len(src) - 1)
    rev = np.stack([np.interp(pos, np.arange(len(src)), src[:, c]) for c in range(2)], axis=1)
    rev = hp(rev, 250) * np.linspace(0.5, 1.0, n)[:, None]
    m.add(a, fade(rev, 0.02, 0.04), 0.9)


def noob(m):
    a = S["noob"][0]
    end = E["crickets"][0]
    seq = Track(end - a + 1)
    oom = ["D2", "A1", "D2", "A1", "Bb1", "F1", "A1", "A1", "D2"]
    for i in range(int((end - a) / BEAT)):
        t = i * BEAT
        if i % 2 == 0:
            seq.add(t, tuba(oom[(i // 2) % len(oom)], 0.28), 0.9)
        else:
            for nt in ("D4", "F4", "A4"):
                seq.add(t, pluck(nt, 0.25, 0.99, 0.5), 0.35)
            seq.add(t, clap(0.2), 0.18)
    mel = [(0, "D5", 1), (1, None, 1), (2, "F5", 1), (4, "A5", 1), (5, "G#5", 1), (6, "A5", 1), (8, "Bb5", 1),
           (10, "A5", 1), (12, "G5", 1), (13, "F5", 1), (14, "E5", 1), (15, "C#5", 1), (16, "D5", 2)]
    for step8, nt, ln in mel:
        if nt:
            seq.add(step8 * BEAT / 2, pluck(nt, 0.3 * ln, 0.993, 0.7), 0.6, pan=0.15)
    for i in range(int((end - a) / (BEAT / 2))):
        seq.add(i * BEAT / 2 + 0.01, hat(False), 0.12 if i % 2 else 0.06, pan=0.3)
    buf = seq.buf[: n_of(end - a)]
    m.add(a, fade(reverb(buf, size=1.0, mix=0.18)[: len(buf)], 0, 0.04), 0.8)


def groove(m, start, bars, chords, intensity=1.0, lead_octave=0, muffle=None, until=None):
    """Phonk-style groove: 808 kick/bass, clap, hats and a pitched cowbell lead."""
    g = Track(bars * 4 * BEAT + 2)
    lead = {
        "Dm": [(0, "D5"), (2, "D5"), (3, "F5"), (6, "A5"), (8, "G5"), (10, "F5"), (11, "E5"), (14, "D5")],
        "Bb": [(0, "F5"), (2, "F5"), (3, "D5"), (6, "Bb4"), (8, "C5"), (10, "D5"), (11, "F5"), (14, "E5")],
        "Gm": [(0, "G5"), (2, "G5"), (3, "Bb5"), (6, "A5"), (8, "G5"), (10, "F5"), (11, "D5"), (14, "E5")],
        "A": [(0, "E5"), (2, "E5"), (3, "C#5"), (6, "A4"), (8, "C#5"), (10, "E5"), (11, "G5"), (14, "A5")],
    }
    roots = {"Dm": "D2", "Bb": "Bb1", "Gm": "G1", "A": "A1"}
    for bi in range(math.ceil(bars)):
        ch = chords[bi % len(chords)]
        t0 = bi * 4 * BEAT
        kicks = [0, 7, 10] + ([14] if intensity > 1 else [])
        for s in kicks:
            g.add(t0 + s * STEP, kick808(0.5), 0.75)
        for s in (4, 12):
            g.add(t0 + s * STEP, clap(0.4), 0.55)
            g.add(t0 + s * STEP, snare(0.3), 0.35)
        for s in range(16):
            if s % 2 == 0 or (intensity > 1 and s >= 12 and bi % 2 == 1):
                g.add(t0 + s * STEP, hat(False), 0.22 if s % 4 == 2 else 0.14, pan=0.35)
        if intensity > 1:
            for s in (2, 6, 10, 14):
                g.add(t0 + s * STEP, hat(True), 0.08, pan=-0.3)
        # 808 bass with slides
        root = hz(roots[ch])
        g.add(t0, bass808(root * 1.5, root, 7 * STEP, glide=0.05), 0.6 * intensity)
        g.add(t0 + 7 * STEP, bass808(root, root, 3 * STEP), 0.5 * intensity)
        g.add(t0 + 10 * STEP, bass808(root, root * (2 ** (3 / 12)), 6 * STEP, glide=0.12), 0.5 * intensity)
        for s, nt in lead[ch]:
            note = nt if lead_octave == 0 else nt[:-1] + str(int(nt[-1]) + lead_octave)
            g.add(t0 + s * STEP, cowbell(note), 0.55, pan=0.12 * (1 if s % 2 else -1))
        g.add(t0, pad(CHORDS[ch], 4 * BEAT + 0.3, cutoff=1600, attack=0.25, release=0.4, vowel=intensity > 1), 0.55 if intensity > 1 else 0.35)
    buf = g.buf[: n_of(bars * 4 * BEAT)]
    if until is not None:
        buf = buf[: n_of(until - start)]
    if muffle:
        buf = lp(buf, muffle, order=4)
    buf = reverb(buf, size=1.2, mix=0.12)[: len(buf)]
    m.add(start, fade(buf, 0, 0.03), 1.0)


def crash(sec=2.0):
    t = tt(sec)
    return hp(noise(sec), 3500) * np.exp(-t / 0.7) * 0.5


def pro(m):
    a, b = S["pro"]
    groove(m, a, (b - a) / (4 * BEAT), ["Dm", "Bb", "Gm", "A"])
    # snare fill into the glitch
    for k in range(4):
        m.add(b - BEAT + k * STEP, snare(0.2), 0.3 + 0.1 * k)
    m.add(E["proLights"], crash(), 0.6)
    m.add(E["proLights"], reverb(pad(["D4", "F4", "A4"], 1.4, cutoff=2500, attack=0.05, release=0.8), size=2.0, mix=0.4), 0.6)


def hacker(m):
    a = S["hacker"][0]
    drop = E["lightning"][1]
    # the beat keeps going behind a wall while the command is typed
    groove(m, a, 2, ["Dm", "Bb"], muffle=420, until=E["chatEnter"])
    m.add(a + 0.5, riser(drop - a - 0.55, 150, 7000), 0.45)
    b = S["hacker"][1]
    groove(m, drop, (b - drop) / (4 * BEAT), ["Dm", "Bb", "Gm"], intensity=1.25)
    m.add(drop, crash(2.4), 0.7)
    m.add(E["faceOn"], crash(2.4), 0.7)
    m.add(E["faceOn"], reverb(pad(["D4", "A4", "D5", "F5"], 2.4, cutoff=3000, attack=0.08, release=1.0), size=2.4, mix=0.45), 0.7)


def cta(m):
    a = S["cta"][0]
    c0, c1 = E["crane"]
    # one more bar, sweeping down as the camera flies out
    sw = Track(2.4)
    groove(sw, 0, 1, ["Gm"], intensity=1.1)
    swb = sweep(sw.buf[: n_of(c1 - c0 + 0.25)], "low", 9000, 500)
    m.add(c0, fade(swb, 0, 0.2), 0.9)
    # breakdown under the count
    bd0, bd1 = c1, E["tilt"][0]
    arp = ["A5", "D6", "F6", "E6", "D6", "A5", "F5", "A5", "Bb5", "D6", "F6", "E6", "D6", "Bb5", "F5", "Bb5"]
    box = Track(bd1 - bd0 + 1.5)
    i = 0
    while i * BEAT / 2 < bd1 - bd0:
        box.add(i * BEAT / 2, musicbox(arp[i % len(arp)], 1.0), 0.8 if i % 4 == 0 else 0.55, pan=0.25 * math.sin(i))
        i += 1
    m.add(bd0, fade(reverb(box.buf, size=1.6, mix=0.35)[: n_of(bd1 - bd0 + 0.05)], 0.05, 0.08), 0.7)
    m.add(bd0, fade(pad(["D3", "F3", "A3"], bd1 - bd0, cutoff=900, attack=0.3, release=0.2, vowel=True), 0, 0.1), 0.45)
    for k in range(int((bd1 - bd0) / BEAT)):
        if k % 2 == 0:
            m.add(bd0 + k * BEAT, kick808(0.4, 110, 45, 20, 0.12, 0.1), 0.4)
    # the twist: a pipe-organ "dun dun dunnn" on the moon flip
    four = next(l for l in T["vo"] if l["id"] == "cta_b")
    f = four["end"] - 0.08
    run = [("A4", 0.07), ("G4", 0.07), ("A4", 0.45), ("G4", 0.065), ("F4", 0.065), ("E4", 0.065), ("D4", 0.065), ("C#4", 0.3), ("D4", 0.0)]
    org = Track(4.0)
    t = 0.0
    for nt, d in run:
        if d == 0.0:
            org.add(t, organ(["D2", "D3", "F3", "A3", "D4"], DUR - f - t + 0.1, attack=0.01, release=0.15, bright=1.3), 1.4)
            break
        org.add(t, organ([nt[:-1] + str(int(nt[-1]) - 1), nt], d + 0.05, attack=0.006, release=0.03, bright=1.3), 1.0)
        t += d
    m.add(f, fade(reverb(org.buf, size=2.8, mix=0.4)[: n_of(DUR - f)], 0, 0.05), 1.15)
    m.add(f, boom(1.5, 70, 30), 0.35)


def compose_music():
    m = Track(DUR + 1)
    hook(m)
    rewind(m, m.buf.copy())
    noob(m)
    pro(m)
    hacker(m)
    cta(m)
    return m.buf[: n_of(DUR)]


# --------------------------------------------------------------------- sfx

def place_kind(tp):
    if tp in ("cobble", "mossy", "bricks", "stone", "roof", "roof_full", "roof_slab", "tomb", "bars", "shell", "glow"):
        return "stone"
    if tp in ("glass", "window", "hwindow"):
        return "glass"
    if tp in ("lantern", "lantern_hang", "soul_lantern"):
        return "metal"
    if tp in ("dirt", "pumpkin", "jack", "hay", "vine"):
        return "dirt"
    return "wood"


def compose_sfx():
    s = Track(DUR + 1)
    # opening thunder
    s.add(0.0, thunder(3.0), 0.9, pan=-0.3)
    s.add(0.02, whoosh(0.3, 800, 5000), 0.25)
    # rewind tape and the play-button clunk
    a, b = S["rewind"]
    s.add(a, glitch(b - a) * 0.6, 0.5)
    s.add(b - 0.02, key_click(True), 0.7)
    s.add(b, pop(300, 700), 0.35)

    last = -1.0
    for p in EV["places"]:
        if p["group"] == "hacker":
            continue
        land = p["t"] + 0.12
        if p["group"] == "pro" and land - last < 0.055:
            continue
        if p["type"] == "cobweb":
            continue
        last = land
        pitch = R.uniform(0.88, 1.15)
        if p.get("anim") == "plop":
            s.add(p["t"] + 0.3, block_place("dirt", 0.6), 1.1)
            s.add(p["t"] + 0.3, bloop(), 0.7)
            continue
        gain = 0.55 if p["group"] == "noob" else 0.38
        s.add(land, block_place(place_kind(p["type"]), pitch), gain, pan=R.uniform(-0.3, 0.3))
    # crash zoom on the pumpkin, then crickets
    s.add(E["noobPunch"] - 0.08, whoosh(0.25, 1500, 7000, 0.8), 0.35)
    c0, c1 = E["crickets"]
    s.add(c0, fade(cricket(c1 - c0, 4400, 0.42, 1) + cricket(c1 - c0, 4950, 0.5, 2) * 0.7, 0.05, 0.1), 0.9)
    # transitions
    s.add(S["pro"][0] - 0.2, whoosh(0.4, 300, 6000), 0.5, pan=0.2)
    s.add(E["proLights"] - 0.01, key_click(True), 0.6)
    s.add(E["proLights"], fwoom(0.6), 0.45)
    s.add(E["proLights"] + 0.05, chime_gliss(["D6", "F6", "A6", "D7"]), 0.25)
    s.add(S["hacker"][0], glitch(0.4), 0.55)
    # typing the command
    s.add(E["chatOpen"], key_click(), 0.4)
    text = T["chat"]
    ta, tb = E["chatType"]
    for i in range(len(text)):
        at = ta + (tb - ta) * (i / len(text)) ** 0.92 + math.sin(i * 12.9898) * 0.012
        s.add(at, key_click(), R.uniform(0.35, 0.55), pan=R.uniform(-0.15, 0.15))
    s.add(E["chatEnter"], key_click(True), 0.8)
    # the drop: thunder, then the pumpkin rises out of the ground
    drop = E["lightning"][1]
    s.add(drop, thunder(2.6, 1.3), 0.9, pan=-0.4)
    s.add(drop, boom(1.6), 0.6)
    h0, h1 = E["hackerBuild"]
    rumble = lp(noise(h1 - h0 + 0.6), 160) * np.sin(np.linspace(0, np.pi, n_of(h1 - h0 + 0.6))) * 0.9
    s.add(h0, rumble, 0.6)
    s.add(h0, riser(h1 - h0 + 0.3, 400, 9000), 0.22)
    scale = ["D6", "F6", "G6", "A6", "C7", "D7", "F7"]
    t = h0
    while t < h1 + 0.3:
        s.add(t, bell(scale[R.integers(len(scale))], 0.5, 2.0, 1.0), R.uniform(0.06, 0.13), pan=R.uniform(-0.6, 0.6))
        t += R.uniform(0.04, 0.11)
    for k in range(int((h1 - h0) / 0.25)):
        s.add(h0 + k * 0.25, block_place("stone", 0.6 + 0.02 * k), 0.25)
    s.add(E["faceOn"], boom(2.0, 100, 30), 0.75)
    s.add(E["faceOn"], fwoom(0.8), 0.55)
    for k in range(6):
        s.add(E["faceOn"] + 0.3 + k * 0.33 + R.uniform(0, 0.1), squeak(), 0.4, pan=R.uniform(-0.7, 0.7))
    # end screen
    s.add(E["crane"][0], whoosh(1.4, 200, 3000, 0.5), 0.45)
    dings = ["D5", "F5", "A5"]
    for k, at in enumerate(E["badges"][:3]):
        s.add(at, pop(), 0.4)
        s.add(at, bell(dings[k], 1.2), 0.5)
    s.add(E["tilt"][0], whoosh(E["tilt"][1] - E["tilt"][0] + 0.1, 500, 8000, 0.7), 0.55)
    f = E["moonFlip"]
    s.add(f, chime_gliss(["D6", "E6", "F6", "A6", "C7", "D7", "F7", "A7"], 0.03), 0.22)
    s.add(f, whoosh(0.3, 1000, 6000), 0.3)
    four_end = next(l for l in T["vo"] if l["id"] == "cta_b")["end"]
    s.add(four_end, lp(thunder(2.0, 0.0), 300), 0.6)
    s.add(E["badges"][3], pop(300, 1200, 0.12), 0.4)
    s.add(E["comment"], pop(500, 1400), 0.35)
    s.add(DUR - 0.75, rev_cymbal(0.75), 0.5)
    # night air under everything
    s.add(0.0, wind(DUR), 0.35)
    return s.buf[: n_of(DUR)]


# ---------------------------------------------------------------------- vo

def compose_vo():
    v = Track(DUR + 1)
    for line in T["vo"]:
        x, sr = sf.read(os.path.join(ROOT, line["file"]))
        assert sr == SR
        x = hp(x, 85)
        x = x / (np.max(np.abs(x)) + 1e-9) * 0.7
        # gentle compression so every word sits at the same level
        env = np.sqrt(np.convolve(x ** 2, np.ones(480) / 480, mode="same")) + 1e-6
        gain = np.minimum(1.0, (0.18 / env) ** 0.35)
        x = x * gain
        x = x / (np.max(np.abs(x)) + 1e-9) * 0.8
        v.add(line["at"], x, 1.0)
    return v.buf[: n_of(DUR)]


def envelope(x, attack=0.01, release=0.25):
    mono = np.abs(x).max(axis=1)
    k = n_of(0.02)
    mono = np.convolve(mono, np.ones(k) / k, mode="same")
    out = np.zeros_like(mono)
    a, r = math.exp(-1 / (attack * SR)), math.exp(-1 / (release * SR))
    # block-wise peak follower (fast enough at this length)
    blk = 64
    level = 0.0
    for i in range(0, len(mono), blk):
        p = mono[i:i + blk].max()
        coef = a ** blk if p > level else r ** blk
        level = coef * level + (1 - coef) * p
        out[i:i + blk] = level
    return out


def limit(x, ceiling=0.8, lookahead=0.005, release=0.08):
    """Look-ahead peak limiter: gain never lets |x| exceed the ceiling."""
    from scipy.ndimage import minimum_filter1d
    peak = np.abs(x).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(peak, 1e-9))
    la = n_of(lookahead)
    g = minimum_filter1d(need, size=2 * la + 1, mode="nearest")
    # smooth release: gain may drop instantly but recovers over `release`
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
    vo = compose_vo()
    for name, buf in (("music", music), ("sfx", sfx), ("vo", vo)):
        sf.write(os.path.join(ROOT, "build", f"{name}.wav"), (buf / max(1.0, np.max(np.abs(buf)))).astype(np.float32), SR)
    # duck music and effects under the voice
    env = envelope(vo)
    duck = np.clip(env / 0.25, 0, 1)[:, None]
    mix = music * 0.42 * (1 - 0.6 * duck) + sfx * 0.55 * (1 - 0.3 * duck) + vo * 1.0
    # phones can't play deep sub-bass; clearing it leaves headroom for voice and melody
    mix = hp(mix, 32, order=4)
    mix = limit(mix * 1.3, ceiling=0.82)
    sf.write(os.path.join(ROOT, "build", "mix.wav"), mix.astype(np.float32), SR)
    peak = np.max(np.abs(mix))
    print(f"mix: {len(mix) / SR:.2f}s peak {20 * math.log10(peak + 1e-9):.1f} dBFS")


if __name__ == "__main__":
    main()
