// "Which Armor Will Save Him?" - the edit plan shared by the renderer, the HUD and the audio.
// Pure data + pure functions of time, so node (audio export) and the browser agree exactly.
// All times in seconds. 120 BPM: every round starts on a beat, every big hit lands on one.

export const FPS = 30;
export const BPM = 120;
export const HOOK = [0, 2];

// armor tiers, weakest first. colours: [base, light, dark]
export const TIERS = [
  { id: 'leather', name: 'LEATHER', base: [139, 90, 55], light: [176, 122, 78], dark: [92, 58, 34] },
  { id: 'copper', name: 'COPPER', base: [201, 112, 66], light: [235, 150, 98], dark: [132, 68, 40], patina: [72, 168, 140], patinaAmt: 0.74 },
  { id: 'gold', name: 'GOLD', base: [240, 196, 46], light: [255, 238, 120], dark: [176, 120, 18] },
  { id: 'chain', name: 'CHAINMAIL', base: [150, 154, 160], light: [200, 204, 210], dark: [84, 88, 96], holes: true },
  { id: 'iron', name: 'IRON', base: [214, 216, 218], light: [250, 250, 250], dark: [150, 152, 156] },
  { id: 'diamond', name: 'DIAMOND', base: [74, 222, 214], light: [170, 255, 248], dark: [28, 150, 150] },
  { id: 'obsidian', name: 'OBSIDIAN', base: [44, 30, 62], light: [110, 74, 156], dark: [18, 12, 28], label: [196, 150, 255] },
];

// every round: the hero drops in at `spawn`, lands at LAND, the golem acts, `hits` are the
// impacts [tau, hearts left after it, strength], `xAt` stamps the red X on the HUD icon.
export const LAND = 0.35;
export const GRAB = 1.0;
export const ROUNDS = [
  { tier: 0, kind: 'slam', start: 2.0, len: 4.0, spawn: [0.9, 0, 1.6], hits: [[2.5, 0, 1.0]], target: [0.6, 0, 2.2], xAt: 3.1 },
  { tier: 1, kind: 'wall', start: 6.0, len: 4.0, spawn: [-0.6, 0, 1.6], hits: [[2.5, 0, 1.0]], target: [-7.9, 1.8, 0.9], release: 2.22, xAt: 3.1 },
  { tier: 2, kind: 'ravine', start: 10.0, len: 4.0, spawn: [1.5, 0, 1.2], hits: [[3.0, 0, 0.8]], target: [10.1, -9.0, 1.6], release: 2.05, xAt: 3.45 },
  { tier: 3, kind: 'stomp', start: 14.0, len: 4.0, spawn: [0.3, 0, 0.5], stompAt: [1.1, 0, 1.9], hits: [[2.5, 0, 1.0]], xAt: 3.1 },
  { tier: 4, kind: 'double', start: 18.0, len: 4.0, spawn: [1.0, 0, 1.4], hits: [[2.0, 4, 0.8], [3.0, 0, 1.0]], target: [-1.9, 0, 1.3], target2: [2.3, 0, 1.9], xAt: 3.5 },
  { tier: 5, kind: 'sky', start: 22.0, len: 4.5, spawn: [0.5, 0, 1.8], hits: [[3.0, 1, 1.3]], drain2: [3.55, 0], target: [2.2, 0, 3.0], release: 1.55, xAt: 3.85 },
  { tier: 6, kind: 'final', start: 26.5, len: 8.0, spawn: [0.3, 0, 1.7], hits: [[2.5, 0.5, 1.6]], target: [0.1, 0, 2.3], standUp: 4.1, punch: 5.45, survive: 4.0, ask: 6.6 },
];
export const DURATION = 34.5;

export const roundAt = (t) => {
  for (let i = ROUNDS.length - 1; i >= 0; i--) if (t >= ROUNDS[i].start) return i;
  return -1;
};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v) => 1 - Math.pow(1 - v, 3);

// hearts shown on the HUD at time t (0..10, halves allowed)
export function heartsAt(t) {
  const r = roundAt(t);
  if (r < 0) return 10;
  const R = ROUNDS[r];
  const tau = t - R.start;
  let h = 10;
  for (const [ht, left] of R.hits) {
    if (tau < ht) break;
    const dur = R.kind === 'final' ? 1.15 : 0.32;
    const k = R.kind === 'final' ? 1 - Math.pow(1 - clamp01((tau - ht) / dur), 2.2) : easeOut(clamp01((tau - ht) / dur));
    h = h + (left - h) * k;
  }
  if (R.drain2 && tau >= R.drain2[0]) h = h + (R.drain2[1] - h) * easeOut(clamp01((tau - R.drain2[0]) / 0.3));
  // refill pops in at the start of each round
  if (r > 0 && tau < 0.45) h = Math.min(h, Math.floor(clamp01(tau / 0.4) * 10));
  return R.kind === 'final' ? Math.max(0.5, Math.round(h * 2) / 2) : Math.round(h * 2) / 2;
}

// everything the audio needs to land on, in video time
export function soundEvents() {
  const ev = [];
  const add = (t, type, extra = {}) => ev.push({ t: +t.toFixed(4), type, ...extra });
  add(0.05, 'title');
  add(0.25, 'roar');
  for (const R of ROUNDS) {
    const s = R.start;
    add(s, 'round', { tier: R.tier });
    add(s + LAND, 'land');
    if (R.kind !== 'stomp') add(s + GRAB, 'grab');
    if (R.release) add(s + R.release, 'whoosh', { big: R.kind === 'sky' });
    if (R.kind === 'slam' || R.kind === 'final') add(s + R.hits[0][0] - 0.38, 'whoosh', { big: R.kind === 'final' });
    if (R.kind === 'double') { add(s + 1.62, 'whoosh'); add(s + 2.62, 'whoosh'); }
    if (R.kind === 'stomp') { add(s + 1.05, 'step'); add(s + 2.1, 'whoosh'); add(s + 1.0, 'run'); }
    for (const [ht, left, str] of R.hits) {
      add(s + ht, 'impact', { strength: str, onStone: R.kind === 'wall' || R.kind === 'ravine' });
      add(s + ht + 0.02, 'hurt', { lethal: left === 0 });
    }
    if (R.drain2) add(s + R.drain2[0], 'hurt', { lethal: true });
    if (R.kind !== 'final') add(s + R.xAt, 'xmark');
    if (R.kind === 'final') {
      for (let k = 0; k < 6; k++) add(s + 3.0 + k * 0.62, 'heartbeat');
      add(s + R.survive, 'survive');
      add(s + 4.75, 'roar');
      add(s + R.punch - 0.3, 'jump');
      add(s + R.punch, 'shatter');
      add(s + R.ask, 'ask');
    }
  }
  return ev.sort((a, b) => a.t - b.t);
}
