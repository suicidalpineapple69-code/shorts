// Writes build/events.json: when each build block lands, so the audio can
// place a sound on it.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildWorld } from './world.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'timeline.json'), 'utf8'));
const world = buildWorld(T);
const places = world.blocks
  .filter((b) => (b.group === 'noob' || b.group === 'pro' || b.group === 'hacker') && b.t !== undefined && !b.type.includes('_rail_'))
  .map((b) => ({ t: +b.t.toFixed(4), group: b.group, type: b.type, anim: b.anim, y: b.y }))
  .sort((a, b) => a.t - b.t);
fs.writeFileSync(path.join(ROOT, 'build', 'events.json'), JSON.stringify({ places }, null, 0));
console.log(`events: ${places.length} block placements`);
