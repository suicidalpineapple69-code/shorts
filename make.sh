#!/usr/bin/env bash
# Builds the short end to end: voiceover -> timeline -> sound -> frames -> out/short.mp4
#   ./make.sh            full quality (1080x1920, 60 fps)
#   ./make.sh preview    half resolution, 15 fps, for checking the edit
set -euo pipefail
cd "$(dirname "$0")"

mode="${1:-final}"
mkdir -p build out

python3 audio/tts.py
python3 timeline.py
node render/export_events.mjs
python3 audio/compose.py

if [ "$mode" = "preview" ]; then
  node render/render.mjs --scale 0.5 --fps 15
  video=build/preview.mp4
  result=out/preview.mp4
else
  node render/render.mjs --fps 60
  video=build/video.mp4
  result=out/short.mp4
fi

ffmpeg -y -loglevel error -i "$video" -i build/mix.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart "$result"
ffmpeg -hide_banner -nostats -i "$result" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):"
echo "wrote $result"
