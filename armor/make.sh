#!/usr/bin/env bash
# Builds "Which Armor Will Save Him?" end to end: timeline -> sound -> frames -> out/armor.mp4
#   armor/make.sh            full quality (1080x1920, 30 fps)
#   armor/make.sh preview    half resolution, 15 fps, for checking the edit
set -euo pipefail
cd "$(dirname "$0")/.."

mode="${1:-final}"
mkdir -p build/armor out

node armor/export.mjs
python3 armor/compose.py

if [ "$mode" = "preview" ]; then
  node render/render.mjs --project armor --scale 0.5 --fps 15
  video=build/armor/preview.mp4
  result=out/armor_preview.mp4
else
  node render/render.mjs --project armor --fps 30 --jobs 2
  video=build/armor/video.mp4
  result=out/armor.mp4
fi

ffmpeg -y -loglevel error -i "$video" -i build/armor/mix.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart "$result"
ffmpeg -hide_banner -nostats -i "$result" -af ebur128=peak=true -f null - 2>&1 | grep -E "^\s+(I|Peak):"
echo "wrote $result"
