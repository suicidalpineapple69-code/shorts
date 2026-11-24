// Writes build/armor/timeline.json: duration, fps and every sound cue, for render.mjs and compose.py.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DURATION, FPS, BPM, ROUNDS, TIERS, soundEvents } from './plan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'build', 'armor');
fs.mkdirSync(out, { recursive: true });
const events = soundEvents();
fs.writeFileSync(path.join(out, 'timeline.json'), JSON.stringify({ duration: DURATION, fps: FPS, bpm: BPM, rounds: ROUNDS.map((r) => ({ ...r, tierName: TIERS[r.tier].name })), events }, null, 1));
console.log(`timeline: ${DURATION}s, ${events.length} sound cues`);
