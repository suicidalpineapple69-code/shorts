// World data: block types, terrain, the three builds and their build schedules.
// Pure module (no DOM, no three.js) so Node can import it to schedule sound effects.

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// shape: geometry kind; tex: texture per face (all/top/bottom/side/front);
// light: name of the light channel driving the emissive glow (see main.js)
export const TYPES = {
  grass: { shape: 'cube', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' } },
  dirt: { shape: 'cube', tex: { all: 'dirt' } },
  path: { shape: 'cube', tex: { top: 'path_top', bottom: 'dirt', side: 'dirt' } },
  gravel: { shape: 'cube', tex: { all: 'gravel' } },
  stone: { shape: 'cube', tex: { all: 'stone' } },
  cobble: { shape: 'cube', tex: { all: 'cobble' } },
  mossy: { shape: 'cube', tex: { all: 'mossy' } },
  bricks: { shape: 'cube', tex: { all: 'bricks' } },
  oak_log: { shape: 'cube', tex: { side: 'oak_log', top: 'oak_log_top', bottom: 'oak_log_top' } },
  dark_log: { shape: 'cube', tex: { side: 'dark_log', top: 'dark_log_top', bottom: 'dark_log_top' } },
  spruce: { shape: 'cube', tex: { all: 'spruce' } },
  spruce_slab: { shape: 'slab', tex: { all: 'spruce' } },
  dark_planks: { shape: 'cube', tex: { all: 'dark_planks' } },
  roof: { shape: 'stairs', tex: { all: 'roof' } },
  roof_full: { shape: 'cube', tex: { all: 'roof' } },
  roof_slab: { shape: 'slab', tex: { all: 'roof' } },
  glass: { shape: 'cube', tex: { all: 'glass' }, alpha: true },
  window: { shape: 'cube', tex: { all: 'window' }, emissive: { all: 'window_e' }, light: 'proWindows' },
  hwindow: { shape: 'cube', tex: { all: 'window' }, emissive: { all: 'window_e' }, light: 'hackerFace' },
  door_lo: { shape: 'door', tex: { all: 'door_lo' } },
  door_hi: { shape: 'door', tex: { all: 'door_hi' }, emissive: { all: 'door_hi_e' }, light: 'proWindows' },
  hdoor_lo: { shape: 'door', tex: { all: 'door_lo' } },
  hdoor_hi: { shape: 'door', tex: { all: 'door_hi' }, emissive: { all: 'door_hi_e' }, light: 'hackerFace' },
  leaves: { shape: 'cube', tex: { all: 'leaves' }, alpha: true },
  spruce_leaves: { shape: 'cube', tex: { all: 'spruce_leaves' }, alpha: true },
  pumpkin: { shape: 'cube', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' } },
  jack: {
    shape: 'cube', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_face' },
    emissive: { front: 'jack_face_e' }, light: 'always',
  },
  shell: { shape: 'cube', tex: { all: 'shell' }, tint: true },
  glow: { shape: 'cube', tex: { all: 'glow' }, emissive: { all: 'glow_e' }, light: 'hackerFace' },
  stem: { shape: 'cube', tex: { side: 'stem', top: 'stem_top', bottom: 'stem_top' } },
  vine: { shape: 'cube', tex: { all: 'vine' }, alpha: true },
  hay: { shape: 'cube', tex: { side: 'hay_side', top: 'hay_top', bottom: 'hay_top' } },
  lantern: { shape: 'lantern', tex: { all: 'lantern' }, emissive: { all: 'lantern_e' }, light: 'always' },
  lantern_hang: { shape: 'lantern_hang', tex: { all: 'lantern' }, emissive: { all: 'lantern_e' }, light: 'always' },
  soul_lantern: { shape: 'lantern', tex: { all: 'soul_lantern' }, emissive: { all: 'soul_lantern_e' }, light: 'always' },
  torch: { shape: 'torch', tex: { all: 'torch' }, emissive: { all: 'torch_e' }, light: 'always' },
  cobweb: { shape: 'cross', tex: { all: 'cobweb' }, alpha: true },
  tall_grass: { shape: 'cross', tex: { all: 'tall_grass' }, alpha: true, tint: true },
  dead_bush: { shape: 'cross', tex: { all: 'dead_bush' }, alpha: true },
  tomb: { shape: 'tomb', tex: { all: 'tomb' } },
  fence: { shape: 'post', tex: { all: 'dark_planks' } },
  fence_rail_x: { shape: 'rail_x', tex: { all: 'dark_planks' } },
  fence_rail_z: { shape: 'rail_z', tex: { all: 'dark_planks' } },
  bars: { shape: 'post', tex: { all: 'iron' } },
  bars_rail_x: { shape: 'rail_x', tex: { all: 'iron' } },
  bars_rail_z: { shape: 'rail_z', tex: { all: 'iron' } },
};

// Plot origins (block coordinates)
export const NOOB = { x: -3, z: 30 };
export const PRO = { x: 0, z: 0 };
export const HACK = { x: 2, z: -36 };

function valueNoise(seed) {
  const r = rng(seed);
  const N = 64;
  const g = Array.from({ length: N * N }, () => r());
  const at = (i, j) => g[((j % N) + N) % N * N + ((i % N) + N) % N];
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = sm(x - i), fy = sm(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// Pumpkin body test in local coordinates of block centres.
const PK = { R: 10, CY: 7.5, TOP: 7.4, BOT: 8.3 };
function inPumpkin(cx, cy, cz) {
  if (cy < 0) return true;
  const rr = Math.hypot(cx, cz);
  const th = Math.atan2(cz, cx);
  const lobe = 1 + 0.06 * Math.cos(10 * th);
  const r = rr / (PK.R * lobe);
  const dy = (cy - PK.CY) / (cy > PK.CY ? PK.TOP : PK.BOT);
  let f = r * r + dy * dy;
  if (cy > PK.CY && rr < 3.6) f += 0.16 * (1 - rr / 3.6);
  return f <= 1;
}

function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const s = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = s(px, py, ax, ay, bx, by), d2 = s(px, py, bx, by, cx, cy), d3 = s(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Carved jack-o'-lantern face, in (u = x, v = y) of block centres on the front.
export function pumpkinFace(u, v) {
  const au = Math.abs(u);
  if (inTri(au, v, 1.6, 8.6, 6.4, 8.6, 4.0, 12.4)) return true; // eyes
  if (inTri(au, v, 0, 6.4, 1.6, 6.4, 0, 8.3) || (au < 0.6 && v > 6.2 && v < 8.0)) return true; // nose
  const lo = 1.9 + 0.055 * u * u, hi = 4.7 + 0.03 * u * u;
  if (au < 7.3 && v > lo && v < hi) {
    if (Math.abs(u + 2.5) < 0.6 && v > hi - 1.2) return false; // top tooth
    if (Math.abs(u - 3.5) < 0.6 && v < lo + 1.2) return false; // bottom tooth
    return true;
  }
  return false;
}

export function buildWorld(T) {
  const blocks = [];
  const occ = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const put = (b) => {
    occ.set(key(b.x, b.y, b.z), b);
    blocks.push(b);
    return b;
  };
  const free = (x, y, z) => !occ.has(key(x, y, z));

  // ---------------------------------------------------------------- terrain
  const n1 = valueNoise(7), n2 = valueNoise(11), n3 = valueNoise(23);
  const X0 = -46, X1 = 50, Z0 = -96, Z1 = 64;
  const pathCells = new Set();
  // path: noob door -> pro porch -> around the cottage -> pumpkin door
  const pathPts = [
    [NOOB.x, NOOB.z + 3], [NOOB.x + 1, NOOB.z - 4], [0, 18], [0, 8], [-1, 7], [-7, 5], [-9, -3],
    [-7, -10], [-2, -16], [HACK.x, -22], [HACK.x, HACK.z + 5],
  ];
  for (let i = 0; i < pathPts.length - 1; i++) {
    const [ax, az] = pathPts[i], [bx, bz] = pathPts[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) * 3);
    for (let s = 0; s <= steps; s++) {
      const x = ax + (bx - ax) * (s / steps), z = az + (bz - az) * (s / steps);
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pathCells.add(`${Math.floor(x + dx - 0.5)},${Math.floor(z + dz - 0.5)}`);
    }
  }
  const grave = (x, z) => x >= 7 && x <= 12 && z >= -3 && z <= 4;
  const height = (x, z) => {
    const ex = Math.max(0, Math.abs(x - 2) - 24), ez = Math.max(0, -58 - z, z - 46);
    const e = Math.min(1, Math.hypot(ex, ez) / 10);
    if (e <= 0) return 0;
    const h = (n1(x / 9, z / 9) * 0.7 + n2(x / 4, z / 4) * 0.3) * 9 * e + e * 2;
    return Math.max(0, Math.floor(h));
  };
  for (let x = X0; x <= X1; x++) {
    for (let z = Z0; z <= Z1; z++) {
      const h = height(x, z);
      let top = 'grass';
      if (pathCells.has(`${x},${z}`)) top = n3(x * 0.7, z * 0.7) > 0.72 ? 'gravel' : 'path';
      else if (grave(x, z) && n3(x * 1.3, z * 1.3) > 0.55) top = n3(x, z) > 0.75 ? 'mossy' : 'gravel';
      put({ x, y: h - 1, z, type: top, group: 'terrain' });
      // dirt only where a hill side is exposed
      const low = Math.min(height(x + 1, z), height(x - 1, z), height(x, z + 1), height(x, z - 1));
      for (let y = h - 2; y >= low - 1; y--) put({ x, y, z, type: 'dirt', group: 'terrain' });
    }
  }
  const groundY = (x, z) => height(x, z);

  // ------------------------------------------------------------- noob hut
  const noob = [];
  {
    const cells = [];
    const ring = [];
    for (let x = -2; x <= 2; x++) ring.push([x, 2]);
    for (let z = 1; z >= -2; z--) ring.push([2, z]);
    for (let x = 1; x >= -2; x--) ring.push([x, -2]);
    for (let z = -1; z <= 1; z++) ring.push([-2, z]);
    for (let y = 0; y <= 2; y++) {
      for (const [x, z] of ring) {
        if (x === 0 && z === 2 && y < 2) continue; // door hole
        let type = 'dirt';
        if (x === 2 && z === 0 && y === 1) type = 'glass';
        if (x === -1 && z === 2 && y === 2) type = 'cobble';
        cells.push({ x, y, z, type });
      }
    }
    cells.push({ x: -1, y: 0, z: 3, type: 'torch' });
    for (let z = 2; z >= -2; z--) for (let x = -2; x <= 2; x++) cells.push({ x, y: 3, z, type: 'dirt' });
    const [a, b] = T.events.noobBuild;
    cells.forEach((c, i) => {
      noob.push(put({ x: NOOB.x + c.x, y: c.y, z: NOOB.z + c.z, type: c.type, group: 'noob', t: a + (b - a) * (i / (cells.length - 1)), anim: 'pop' }));
    });
    noob.push(put({ x: NOOB.x + 1, y: 4, z: NOOB.z, type: 'pumpkin', group: 'noob', t: T.events.noobPumpkin, anim: 'plop' }));
  }

  // ---------------------------------------------------------- pro cottage
  const pro = [];
  {
    const R = rng(5);
    const phases = { found: [], walls: [], roof: [], porch: [], grave: [] };
    const add = (ph, x, y, z, type, r = 0, k = 0) => phases[ph].push({ x, y, z, type, r, k });
    const ang = (x, z) => Math.atan2(z, x);
    for (let x = -5; x <= 5; x++) for (let z = -4; z <= 4; z++) {
      if (Math.abs(x) === 5 || Math.abs(z) === 4) add('found', x, 0, z, R() < 0.3 ? 'mossy' : 'cobble', 0, ang(x, z));
    }
    for (let y = 1; y <= 4; y++) {
      for (let x = -5; x <= 5; x++) for (let z = -4; z <= 4; z++) {
        if (!(Math.abs(x) === 5 || Math.abs(z) === 4)) continue;
        let type = 'spruce', r = 0;
        const corner = Math.abs(x) === 5 && Math.abs(z) === 4;
        if (corner || y === 4) type = 'dark_log';
        else if (z === 4) {
          if (x === 0 && y <= 2) { type = y === 1 ? 'door_lo' : 'door_hi'; r = 0; }
          else if (Math.abs(x) === 3 && (y === 2 || y === 3)) type = 'window';
          else if (Math.abs(x) === 1) type = 'dark_log';
        } else if (z === -4) {
          if (Math.abs(x) === 2 && (y === 2 || y === 3)) type = 'window';
        } else if (z === 0 && (y === 2 || y === 3)) type = 'window';
        add('walls', x, y, z, type, r, y * 10 + ang(x, z));
      }
    }
    // gable roof, ridge along x
    for (let k = 0; k <= 4; k++) {
      for (let x = -6; x <= 6; x++) {
        add('roof', x, 5 + k, 5 - k, 'roof', 0, k * 10 + x * 0.01);
        if (!(x === 3 && k === 3)) add('roof', x, 5 + k, -5 + k, 'roof', 2, k * 10 + x * 0.01);
      }
    }
    for (let x = -6; x <= 6; x++) {
      add('roof', x, 9, 0, 'roof_full', 0, 50 + x * 0.01);
      add('roof', x, 10, 0, 'roof_slab', 0, 55 + x * 0.01);
    }
    for (const gx of [-5, 5]) {
      for (let y = 5; y <= 8; y++) for (let z = -(9 - y); z <= 9 - y; z++) {
        const win = z === 0 && (y === 6 || y === 7);
        add('roof', gx, y, z, win ? 'window' : 'dark_planks', 0, (y - 5) * 10 + 1);
      }
    }
    for (let y = 5; y <= 11; y++) add('roof', 3, y, -2, y % 3 === 0 ? 'mossy' : 'bricks', 0, 30 + y);
    // porch
    for (let x = -3; x <= 3; x++) for (let z = 5; z <= 6; z++) add('porch', x, 0, z, 'spruce_slab', 0, 0);
    for (const px of [-3, 3]) for (let y = 1; y <= 3; y++) add('porch', px, y, 6, 'fence', 0, y);
    for (let x = -3; x <= 3; x++) for (let z = 5; z <= 6; z++) add('porch', x, 4, z, 'roof_slab', 0, 4);
    add('porch', -2, 3, 6, 'lantern_hang', 0, 5);
    add('porch', 2, 3, 6, 'lantern_hang', 0, 5);
    add('porch', -3, 3, 5, 'cobweb', 0, 6);
    add('porch', 6, 4, 5, 'cobweb', 0, 6);
    add('porch', -2, 0, 7, 'jack', 0, 6);
    add('porch', 2, 0, 7, 'jack', 0, 6);
    add('porch', -6, 0, 6, 'hay', 0, 7);
    add('porch', -6, 1, 6, 'jack', 1, 8);
    add('porch', 5, 0, 6, 'pumpkin', 0, 7);
    add('porch', 6, 0, 7, 'pumpkin', 0, 7.5);
    // graveyard
    const gf = [];
    for (let x = 7; x <= 12; x++) { gf.push([x, -3]); if (x <= 8 || x >= 11) gf.push([x, 4]); }
    for (let z = -2; z <= 3; z++) { gf.push([7, z]); gf.push([12, z]); }
    for (const [x, z] of gf) add('grave', x, 0, z, 'bars', 0, 0 + Math.hypot(x - 9.5, z - 0.5) * 0.01);
    for (const [x, z] of [[8, -1], [10, -1], [8, 2], [10, 2]]) add('grave', x, 0, z, 'tomb', 0, 2);
    add('grave', 12, 1, 4, 'soul_lantern', 0, 4);
    const trunk = [[11, 0, -2], [11, 1, -2], [11, 2, -2], [11, 3, -2], [11, 4, -2], [10, 4, -2], [9, 5, -2],
      [12, 5, -2], [12, 6, -1], [11, 5, -3], [11, 6, -3], [10, 6, -1]];
    trunk.forEach(([x, y, z], i) => add('grave', x, y, z, 'dark_log', 0, 3 + i * 0.01));
    add('grave', 9, 4, -2, 'lantern_hang', 0, 3.5);

    const sched = (list, a, b) => {
      list.sort((p, q) => p.k - q.k);
      list.forEach((c, i) => {
        pro.push(put({ x: PRO.x + c.x, y: c.y, z: PRO.z + c.z, type: c.type, r: c.r, group: 'pro', t: a + (b - a) * (i / Math.max(1, list.length - 1)), anim: 'pop' }));
      });
    };
    const [a, b] = T.events.proBuild;
    const W = b - a;
    sched(phases.found, a, a + 0.14 * W);
    sched(phases.walls, a + 0.12 * W, a + 0.5 * W);
    sched(phases.roof, a + 0.48 * W, a + 0.86 * W);
    sched(phases.porch, a + 0.84 * W, b);
    sched(phases.grave, ...T.events.proGrave);
  }

  // ------------------------------------------------- hacker giant pumpkin
  const hack = [];
  {
    const cells = [];
    const B = 12;
    for (let x = -B; x < B; x++) for (let z = -B; z < B; z++) for (let y = 0; y <= 16; y++) {
      const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
      if (!inPumpkin(cx, cy, cz)) continue;
      const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      if (nb.every(([dx, dy, dz]) => inPumpkin(cx + dx, cy + dy, cz + dz))) continue;
      let type = 'shell', r = 0;
      if (cz > 0 && pumpkinFace(cx, cy)) type = 'glow';
      if (cz > 0 && Math.abs(cx) < 1 && y <= 1) type = y === 0 ? 'hdoor_lo' : 'hdoor_hi';
      if (Math.abs(cz) < 1 && Math.abs(cx) > 6 && (y === 4 || y === 5 || y === 10 || y === 11)) {
        type = 'hwindow';
      }
      const th = Math.atan2(cz, cx);
      // ribs: bright on the lobes, darker in the grooves, lighter towards the top
      const rib = Math.cos(10 * th);
      const shade = 0.8 + 0.14 * rib + 0.07 * (cy / 15);
      cells.push({ x, y, z, type, r, shade, th });
    }
    // only the front-most block of each door column becomes the door
    const doorFront = new Map();
    for (const c of cells) if (c.type.startsWith('hdoor')) {
      const k = `${c.x},${c.y}`;
      if (!doorFront.has(k) || doorFront.get(k).z < c.z) doorFront.set(k, c);
    }
    for (const c of cells) if (c.type.startsWith('hdoor') && doorFront.get(`${c.x},${c.y}`) !== c) c.type = 'shell';
    // stem and leaves on top
    const topY = Math.max(...cells.filter((c) => Math.abs(c.x + 0.5) < 1 && Math.abs(c.z + 0.5) < 1).map((c) => c.y));
    const stem = [[0, 1, 0], [-1, 1, 0], [0, 1, -1], [-1, 1, -1], [0, 2, 0], [-1, 2, 0], [0, 2, -1], [-1, 2, -1],
      [0, 3, 0], [0, 3, -1], [1, 4, 0], [1, 4, -1], [1, 5, 0], [2, 5, 0]];
    for (const [x, dy, z] of stem) cells.push({ x, y: topY + dy, z, type: 'stem', shade: 1, th: 9 });
    const vines = [[1, 1, 1], [2, 1, 1], [2, 1, 2], [3, 1, 2], [-2, 1, -2], [-3, 1, -2], [-3, 1, -3], [-2, 1, 1], [-3, 1, 1],
      [1, 1, -2], [2, 1, -3], [2, 2, -3]];
    for (const [x, dy, z] of vines) {
      // rest the leaves on the shell surface
      let y = topY + dy;
      while (y > 1 && !cells.some((c) => c.x === x && c.z === z && c.y === y - 1)) y--;
      cells.push({ x, y, z, type: 'vine', shade: 1, th: 9.5 });
    }
    const [a, b] = T.events.hackerBuild;
    // spiral from the ground up
    const maxY = Math.max(...cells.map((c) => c.y));
    for (const c of cells) {
      const turn = (c.th + Math.PI) / (2 * Math.PI);
      c.k = c.th > 8 ? 1 + (c.th - 9) * 0.1 : (c.y + turn) / (maxY + 1);
    }
    const ks = cells.map((c) => c.k);
    const kmin = Math.min(...ks), kmax = Math.max(...ks);
    for (const c of cells) {
      const u = (c.k - kmin) / (kmax - kmin);
      hack.push(put({ x: HACK.x + c.x, y: c.y, z: HACK.z + c.z, type: c.type, r: c.r, group: 'hacker',
        t: a + (b - a) * u, u, anim: 'rise', shade: c.shade }));
    }
    // jack-o'-lantern posts along the path
    const posts = [[-3, 7], [3, 7], [-3, 11], [3, 11]];
    posts.forEach(([x, z], i) => {
      const t = b + 0.1 + i * 0.08;
      for (let y = 0; y <= 1; y++) hack.push(put({ x: HACK.x + x, y, z: HACK.z + z, type: 'fence', group: 'hacker', t, u: 1, anim: 'rise' }));
      hack.push(put({ x: HACK.x + x, y: 2, z: HACK.z + z, type: 'jack', r: 0, group: 'hacker', t: t + 0.05, u: 1, anim: 'rise' }));
    });
  }

  // ----------------------------------------------------------- decoration
  const R = rng(99);
  const reserved = (x, z) =>
    (x >= NOOB.x - 5 && x <= NOOB.x + 5 && z >= NOOB.z - 4 && z <= NOOB.z + 6) ||
    (x >= -8 && x <= 14 && z >= -7 && z <= 9) ||
    (x >= HACK.x - 13 && x <= HACK.x + 13 && z >= HACK.z - 13 && z <= HACK.z + 15) ||
    pathCells.has(`${x},${z}`);
  const decor = (x, y, z, type, r = 0) => free(x, y, z) && put({ x, y, z, type, r, group: 'decor' });

  const deadTree = (x0, z0, h, seed) => {
    const r = rng(seed);
    const y0 = groundY(x0, z0);
    for (let y = 0; y < h; y++) decor(x0, y0 + y, z0, 'dark_log');
    for (let b = 0; b < 3; b++) {
      let x = x0, y = y0 + h - 1 - Math.floor(r() * 2), z = z0;
      const dx = r() < 0.5 ? -1 : 1, dz = r() < 0.5 ? -1 : 1, alongX = r() < 0.5;
      for (let s = 0; s < 3; s++) {
        if (alongX) x += dx; else z += dz;
        if (s > 0 || r() < 0.5) y += 1;
        decor(x, y, z, 'dark_log');
      }
    }
  };
  const spruce = (x0, z0, h, seed) => {
    const r = rng(seed);
    const y0 = groundY(x0, z0);
    for (let y = 0; y < h; y++) decor(x0, y0 + y, z0, 'dark_log');
    for (let y = 2; y <= h; y++) {
      const rad = Math.max(0, Math.round((h - y) / 2.2 + (y % 2 ? 0.4 : 0)));
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > rad + 0.5 || (dx === 0 && dz === 0 && y < h)) continue;
        if (r() < 0.12 && rad > 0) continue;
        decor(x0 + dx, y0 + y, z0 + dz, 'spruce_leaves');
      }
    }
    decor(x0, y0 + h + 1, z0, 'spruce_leaves');
  };
  for (const [x, z, h, s] of [[-14, 12, 6, 1], [22, 30, 5, 2], [-16, -18, 7, 3], [17, -14, 6, 4], [-12, 42, 5, 5], [14, 36, 6, 6], [-18, -52, 7, 7], [20, -50, 6, 8]]) deadTree(x, z, h, s);
  for (const [x, z, h, s] of [[-22, 4, 11, 11], [-25, -10, 13, 12], [-21, 24, 10, 13], [28, -12, 12, 14], [26, -24, 13, 15], [22, 26, 11, 16],
    [-24, -34, 12, 17], [-20, -62, 14, 18], [24, -64, 13, 19], [28, 44, 12, 20], [-27, 46, 12, 21], [-30, -80, 14, 22], [30, -84, 15, 23], [6, -76, 13, 24], [-10, -82, 12, 25]]) spruce(x, z, h, s);

  for (let i = 0; i < 1400; i++) {
    const x = Math.floor(X0 + 4 + R() * (X1 - X0 - 8)), z = Math.floor(Z0 + 4 + R() * (Z1 - Z0 - 8));
    if (reserved(x, z)) continue;
    const y = groundY(x, z);
    const p = R();
    if (p < 0.035) decor(x, y, z, 'pumpkin', Math.floor(R() * 4));
    else if (p < 0.05 && Math.abs(x) < 24) decor(x, y, z, 'jack', Math.floor(R() * 4));
    else if (p < 0.08) decor(x, y, z, 'dead_bush');
    else if (p < 0.09 && Math.abs(x) < 26) decor(x, y, z, 'tomb', Math.floor(R() * 2) * 2);
    else decor(x, y, z, 'tall_grass');
  }

  // fence rails between neighbouring posts
  const rails = [];
  for (const b of blocks) {
    if (b.type !== 'fence' && b.type !== 'bars') continue;
    for (const [dx, dz, suf] of [[1, 0, '_rail_x'], [0, 1, '_rail_z']]) {
      const n = occ.get(key(b.x + dx, b.y, b.z + dz));
      if (n && n.type === b.type) {
        rails.push({ ...b, type: b.type + suf, t: b.t !== undefined ? Math.max(b.t, n.t) : undefined });
      }
    }
  }
  blocks.push(...rails);

  const lights = {
    noobTorch: [NOOB.x - 0.5, 1.4, NOOB.z + 3.8],
    porchL: [-1.5, 3.2, 6.6], porchR: [2.5, 3.2, 6.6],
    proInside: [0.5, 2.5, 6.0], soul: [12.5, 1.8, 4.5],
    faceA: [HACK.x, 9, HACK.z + 6.5], faceB: [HACK.x, 2.5, HACK.z + 4],
    hackPath: [HACK.x + 0.5, 3, HACK.z + 9],
  };
  const anchors = {
    noob: [NOOB.x + 0.5, 1.6, NOOB.z + 0.5],
    noobPumpkin: [NOOB.x + 1.5, 4.5, NOOB.z + 0.5],
    pro: [PRO.x + 0.5, 4, PRO.z + 0.5],
    hack: [HACK.x, 7.5, HACK.z],
    badgeNoob: [NOOB.x + 0.5, 6.5, NOOB.z + 0.5],
    badgePro: [PRO.x + 2.5, 11.5, PRO.z + 2.5],
    badgeHack: [HACK.x - 2, 21, HACK.z + 4],
  };
  return { blocks, lights, anchors, counts: { noob: noob.length, pro: pro.length, hacker: hack.length } };
}
