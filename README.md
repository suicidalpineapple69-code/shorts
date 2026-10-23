# shorts

Code that renders Minecraft-style YouTube Shorts. Everything in the video is generated here: the
voxel world, pixel textures, camera work, captions, voiceover, music and sound effects. No game
assets or third-party footage are used.

Current short: **Noob vs Pro vs Hacker vs GOD: Halloween House** (30 s, 1080x1920, 60 fps).

## Build

```sh
npm install                      # three.js + fonts
pip install kokoro-onnx soundfile scipy sherpa-onnx
# models (not in git):
#   models/kokoro-v1.0.onnx, models/voices-v1.0.bin      github.com/thewh1teagle/kokoro-onnx releases
#   models/asr/sherpa-onnx-zipformer-small-en-2023-06-26  github.com/k2-fsa/sherpa-onnx releases (asr-models)
./make.sh preview                # half-res, 15 fps check  -> out/preview.mp4
./make.sh                        # final                   -> out/short.mp4
```

Rendering uses headless Chromium (Playwright) with software WebGL; a final render is about
1.4 s per frame on 4 cores.

## How it fits together

| Step | File | Output |
| --- | --- | --- |
| Script | `script.json` | lines, caption emphasis markers (`^ * # $ ! %` = colours) |
| Voiceover | `audio/tts.py` | Kokoro TTS per line; ASR transcribes each line back to verify it and time every caption word |
| Edit | `timeline.py` | `build/timeline.json`: sections, line placement, every build/FX event |
| World | `render/world.js` | terrain, the three builds and their block-by-block schedules |
| Picture | `render/main.js`, `shots.js`, `overlay.js`, `textures.js`, `fx.js` | three.js scene, camera moves, captions, post effects |
| Frames | `render/render.mjs` | drives the page and encodes `build/video.mp4` |
| Sound | `audio/synth.py`, `audio/compose.py` | original score (120 BPM, D minor), effects synced to block placements, voice ducking, limiter |

`node render/render.mjs --stills 3.2,12.5` renders single frames to `build/stills/` for checking shots.
