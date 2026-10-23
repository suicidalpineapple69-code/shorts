"""Edit decision list for the short: when every line, build, cut and effect happens.

Reads the voiceover timings from build/vo/lines.json and writes build/timeline.json,
which the renderer (render/) and the audio mixer (audio/) both follow.
Times are in seconds; the grid is 120 BPM, so section cuts land on beats.
"""
import json
import os

ROOT = os.path.dirname(os.path.abspath(__file__))

DURATION = 30.0
BPM = 120

SECTIONS = {
    "hook": [0.0, 2.5],
    "rewind": [2.5, 3.0],
    "noob": [3.0, 8.5],
    "pro": [8.5, 15.0],
    "hacker": [15.0, 23.5],
    "cta": [23.5, DURATION],
}

# the end-screen count ("one, two, three") is shown by the badges, not captions
NO_CAPTION = {"cta_1", "cta_2", "cta_3"}

# when each voice line starts
VO_AT = {
    "hook": 0.20,
    "noob_a": 3.20,
    "noob_b": 5.95,
    "pro_a": 8.70,
    "pro_b": 11.20,
    "hack_a": 15.20,
    "hack_b": 18.00,
    "cta_a": 23.70,
    "cta_1": 25.20,
    "cta_2": 25.80,
    "cta_3": 26.40,
    "cta_b": 27.30,
}

EVENTS = {
    "lightning": [0.0, 17.5],
    "noobBuild": [3.05, 5.55],
    "noobPumpkin": 5.80,
    "noobPunch": 6.92,
    "crickets": [7.45, 8.5],
    "proBuild": [8.55, 11.3],
    "proGrave": [11.25, 12.75],
    "proLights": 13.5,
    "chatOpen": 15.45,
    "chatType": [15.6, 16.85],
    "chatEnter": 17.05,
    "hackerBuild": [17.55, 20.75],
    "faceOn": 21.0,
    "crane": [23.5, 25.0],
    "badges": [25.2, 25.8, 26.4, 27.69],
    "tilt": [27.22, 27.62],
    "moonFlip": 27.69,
    "comment": 28.4,
    "flashOut": [29.82, DURATION],
}

CHAT_TEXT = "/place structure pumpkin_mansion"


def main():
    lines = {l["id"]: l for l in json.load(open(os.path.join(ROOT, "build", "vo", "lines.json")))}
    vo = []
    for lid, at in VO_AT.items():
        l = lines[lid]
        vo.append({
            "id": lid,
            "file": l["file"],
            "at": at,
            "end": round(at + l["duration"], 3),
            "caption": lid not in NO_CAPTION,
            "words": [{"w": w["w"], "start": round(at + w["start"], 3), "end": round(at + w["end"], 3)} for w in l["words"]],
        })
    # sanity: lines must not overlap
    for a, b in zip(vo, vo[1:]):
        assert a["end"] <= b["at"], f"{a['id']} overlaps {b['id']}"
    tl = {
        "duration": DURATION,
        "fps": 30,
        "bpm": BPM,
        "sections": SECTIONS,
        "events": EVENTS,
        "chat": CHAT_TEXT,
        "vo": vo,
    }
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    json.dump(tl, open(os.path.join(ROOT, "build", "timeline.json"), "w"), indent=1)
    for v in vo:
        print(f"{v['id']:7s} {v['at']:6.2f} -> {v['end']:6.2f}")


if __name__ == "__main__":
    main()
