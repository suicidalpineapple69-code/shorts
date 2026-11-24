// Procedural voxel models: the floating island arena, the hero (with armor tiers) and the moss golem.
// Everything is generated from code: no game assets.
import { Grid, rgb, arr, shade, mix, hash3, vnoise, voxModel } from './voxel.js';

// ------------------------------------------------------------------ terrain
export const TVS = 0.25; // terrain voxel = quarter block
export const TERRAIN = { x0: -18, x1: 18, y0: -13, y1: 9, z0: -18, z1: 16 };
export const RAVINE = { x0: 8.5, x1: 11.5, z0: -12, z1: 13, floor: -9.2 };
export const WALL = { x0: -9.25, x1: -7.75, z0: -1.5, z1: 3.5, y1: 4.5 };

const GRASS = [[96, 168, 62], [108, 180, 70], [86, 156, 56], [118, 188, 76], [100, 172, 64], [80, 146, 52]];
const DIRT = [[128, 92, 62], [116, 82, 54], [140, 102, 70], [104, 74, 48]];
const STONE = [[128, 128, 130], [118, 118, 120], [138, 138, 140], [108, 108, 112], [146, 146, 148]];

const pickC = (list, h) => arr(list[Math.floor(h * list.length) % list.length]);

export function islandEdge(wx, wz) {
  // radius of the island in this direction (jagged)
  const a = Math.atan2(wz, wx);
  return 15.2 + (vnoise(Math.cos(a) * 2.2 + 5, Math.sin(a) * 2.2 + 5, 0, 3) - 0.5) * 3.2;
}

export function surfaceHeight(wx, wz) {
  // flat arena, a hill rising behind (negative z), gentle bumps
  let h = 0;
  const back = Math.max(0, (-wz - 6.5) / 5);
  h += Math.min(1, back) * 3.2 + Math.max(0, back - 1) * 1.2;
  h += (vnoise(wx * 0.18, wz * 0.18, 0, 9) - 0.5) * 0.9 * Math.min(1, back + Math.max(0, Math.abs(wx) - 7) / 5);
  return h;
}

export function buildTerrain() {
  const T = TERRAIN;
  const nx = Math.round((T.x1 - T.x0) / TVS), ny = Math.round((T.y1 - T.y0) / TVS), nz = Math.round((T.z1 - T.z0) / TVS);
  const g = new Grid(nx, ny, nz, TVS, [T.x0, T.y0, T.z0]);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const [wx, , wz] = g.center(x, 0, z);
    const r = Math.hypot(wx, wz), edge = islandEdge(wx, wz);
    if (r > edge) continue;
    let top = surfaceHeight(wx, wz);
    // arena floor is perfectly flat so the action reads cleanly
    if (Math.abs(wx) < 7.5 && wz > -6) top = 0;
    // the island tapers underneath like an upside-down mountain
    let depthHere = -3 - (1 - Math.pow(r / edge, 2.2)) * 9 - vnoise(wx * 0.4, wz * 0.4, 1, 4) * 2;
    // a deep keel of rock under the ravine so it has walls and a floor all the way down
    if (wx > RAVINE.x0 - 4 && wx < RAVINE.x1 + 4 && wz > RAVINE.z0 - 2 && wz < RAVINE.z1 + 1) depthHere = Math.min(depthHere, RAVINE.floor - 2.5);
    const inRavine = wx > RAVINE.x0 + vnoise(wz * 0.5, 2, 0, 5) * 0.8 - 0.4 && wx < RAVINE.x1 + vnoise(wz * 0.5, 7, 0, 6) * 0.8 - 0.4 && wz > RAVINE.z0 && wz < RAVINE.z1;
    const ty = g.vy(top - 0.001);
    for (let y = 0; y < ny; y++) {
      const wy = T.y0 + (y + 0.5) * TVS;
      if (wy > top || wy < depthHere) continue;
      if (inRavine) {
        // ravine walls narrow a little with depth; floor of gravel
        const floor = RAVINE.floor + vnoise(wx, wz, 0, 8) * 0.6;
        if (wy > floor) continue;
      }
      const d = top - wy;
      const h = hash3(x, y, z, 1);
      let c;
      if (inRavine) c = h < 0.5 ? pickC([[130, 122, 116], [112, 104, 98], [148, 140, 132]], hash3(x, y, z, 2)) : pickC(STONE, h);
      else if (y === ty) c = pickC(GRASS, h);
      else if (d < 1.0 + vnoise(wx, wz, 0, 2) * 0.6) c = pickC(DIRT, h);
      else {
        c = pickC(STONE, h);
        if (hash3(x >> 1, y >> 1, z >> 1, 7) < 0.025) c = arr(hash3(x, 0, z, 3) < 0.5 ? [190, 120, 90] : [70, 70, 74]); // ore specks
      }
      g.set(x, y, z, c);
    }
  }
  // grass tint patches so the field isn't uniform
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    for (let y = ny - 1; y >= 0; y--) {
      const c = g.get(x, y, z);
      if (!c) continue;
      const [wx, , wz] = g.center(x, y, z);
      const k = 0.9 + vnoise(wx * 0.35, wz * 0.35, 0, 11) * 0.2;
      g.set(x, y, z, shade(c, k));
      break;
    }
  }
  // stone wall (for the copper round)
  for (let y = g.vy(0); y < g.vy(WALL.y1); y++) for (let z = g.vz(WALL.z0); z < g.vz(WALL.z1); z++) for (let x = g.vx(WALL.x0); x < g.vx(WALL.x1); x++) {
    const [, wy, wz] = g.center(x, y, z);
    // brick courses: half-block rows with offset joints
    const row = Math.floor(wy / 0.5);
    const joint = (Math.floor((wz + (row % 2) * 0.5) / 1.0 * 4) % 4 === 0) || (Math.floor(wy / 0.25) % 2 === 0 && hash3(x, y, z, 5) < 0.0);
    const top = wy > WALL.y1 - 0.25 - (vnoise(wz * 1.5, 0, 0, 12) > 0.6 ? 0.25 : 0);
    if (top && hash3(0, 0, Math.floor(wz * 2), 13) < 0.35) continue;
    const h = hash3(x, y, z, 4);
    let c = pickC([[150, 150, 150], [132, 132, 134], [164, 162, 158], [120, 120, 124]], h);
    if (joint) c = arr([92, 90, 88]);
    if (vnoise(wz * 0.9, wy * 0.9, 0, 14) > 0.68) c = mix(c, arr([92, 140, 62]), 0.55); // moss
    g.set(x, y, z, c);
  }
  // trees on the hill + edges
  const trees = [[-6, -11], [-1.5, -12.5], [4.5, -11.5], [-10.5, -8], [9.5, -9.5], [13.5, -3.5], [-13.2, 2], [1.5, -14.5], [-4, -14.5]];
  for (const [tx, tz] of trees) placeTree(g, tx, tz);
  // little flowers
  for (let i = 0; i < 60; i++) {
    const fx = (hash3(i, 1, 0, 21) - 0.5) * 26, fz = (hash3(i, 2, 0, 21) - 0.5) * 26;
    if (Math.hypot(fx, fz) > 13 || (Math.abs(fx) < 8 && fz > -7) || (fx > 7 && fx < 13)) continue;
    const top = topSolid(g, g.vx(fx), g.vz(fz));
    if (top < 0) continue;
    const col = hash3(i, 3, 0, 21) < 0.5 ? arr([245, 245, 235]) : arr([250, 214, 60]);
    g.set(g.vx(fx), top + 1, g.vz(fz), col);
  }
  return g;
}

export function topSolid(g, x, z) {
  for (let y = g.ny - 1; y >= 0; y--) if (g.get(x, y, z)) return y;
  return -1;
}

function placeTree(g, tx, tz) {
  const bx = g.vx(tx), bz = g.vz(tz);
  const top = topSolid(g, bx, bz);
  if (top < 0) return;
  const trunkH = 14 + Math.floor(hash3(bx, bz, 0, 31) * 6);
  for (let y = 1; y <= trunkH; y++) for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) {
    const h = hash3(bx + dx, top + y, bz + dz, 32);
    g.set(bx + dx, top + y, bz + dz, arr(h < 0.3 ? [86, 62, 38] : h < 0.7 ? [104, 76, 46] : [94, 68, 42]));
  }
  const cy = top + trunkH + 2, cx = bx + 1, cz = bz + 1;
  const R = 6 + hash3(bx, bz, 1, 33) * 2;
  for (let y = -5; y <= 7; y++) for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) {
    const d = Math.hypot(x, y * 1.25, z) + (vnoise((cx + x) * 0.45, (cy + y) * 0.45, (cz + z) * 0.45, 34) - 0.5) * 4;
    if (d > R) continue;
    if (g.get(cx + x, cy + y, cz + z)) continue;
    const h = hash3(cx + x, cy + y, cz + z, 35);
    if (h < 0.08 && d > R - 1.5) continue;
    const k = 0.78 + (y + 5) / 12 * 0.32;
    g.set(cx + x, cy + y, cz + z, shade(arr(h < 0.33 ? [58, 128, 44] : h < 0.66 ? [70, 142, 52] : [50, 112, 40]), k));
  }
}

// ------------------------------------------------------------------ hero
export const HVS = 1 / 16;
const SKIN = [[233, 180, 140], [226, 170, 130], [238, 188, 148]];
const HAIR = [[196, 104, 40], [178, 92, 34], [210, 118, 48]];
const SHIRT = [[226, 70, 58], [210, 60, 50], [236, 84, 70]];
const PANTS = [[52, 70, 120], [46, 62, 108], [58, 78, 130]];

function hc(list, x, y, z, s) { return pickC(list, hash3(x, y, z, s)); }

// hero part definitions in voxels: size and pivot (all pivots at the joint)
export const HERO_PARTS = {
  head: { size: [8, 8, 8], pivot: [4, 0, 4], at: [0, 24, 0] },
  torso: { size: [8, 12, 4], pivot: [4, 0, 2], at: [0, 12, 0] },
  armL: { size: [4, 12, 4], pivot: [2, 11, 2], at: [6, 23, 0] },
  armR: { size: [4, 12, 4], pivot: [2, 11, 2], at: [-6, 23, 0] },
  legL: { size: [4, 12, 4], pivot: [2, 12, 2], at: [2, 12, 0] },
  legR: { size: [4, 12, 4], pivot: [2, 12, 2], at: [-2, 12, 0] },
};

function heroBody(part) {
  const P = HERO_PARTS[part];
  const [sx, sy, sz] = P.size;
  return voxModel(sx, sy, sz, HVS, (x, y, z) => {
    if (part === 'head') {
      const front = z === sz - 1, back = z === 0;
      if (y >= 6 || (back && y >= 2) || ((x === 0 || x === sx - 1) && y >= 4 && z < 6)) return hc(HAIR, x, y, z, 1);
      if (front) {
        if (y === 5 && (x === 1 || x === 6)) return hc(HAIR, x, y, z, 2); // brows
        if (y === 4 && (x === 1 || x === 6)) return rgb(250, 250, 250);
        if (y === 4 && (x === 2 || x === 5)) return rgb(46, 110, 200);
        if (y === 1 && x >= 3 && x <= 4) return rgb(160, 84, 70);
        if (y === 2 && (x === 2 || x === 5)) return rgb(214, 150, 112); // cheeks
      }
      return hc(SKIN, x, y, z, 3);
    }
    if (part === 'torso') {
      if (y >= 10 && x >= 2 && x <= 5 && z === sz - 1 && y === 11) return hc(SKIN, x, y, z, 4);
      if (y <= 1) return rgb(60, 44, 34); // belt
      return hc(SHIRT, x, y, z, 5);
    }
    if (part === 'armL' || part === 'armR') {
      if (y >= 7) return hc(SHIRT, x, y, z, 6);
      return hc(SKIN, x, y, z, 7);
    }
    if (y <= 1) return hc([[70, 70, 74], [60, 60, 64]], x, y, z, 8); // shoes
    return hc(PANTS, x, y, z, 9);
  }, P.pivot);
}

// armour shell: one voxel thicker on every side, only where the tier covers
function heroArmor(part, tier) {
  const P = HERO_PARTS[part];
  const [sx, sy, sz] = P.size;
  const base = arr(tier.base), light = arr(tier.light), dark = arr(tier.dark);
  const pv = [P.pivot[0] + 1, P.pivot[1] + 1, P.pivot[2] + 1];
  return voxModel(sx + 2, sy + 2, sz + 2, HVS, (x, y, z) => {
    const shell = x === 0 || y === 0 || z === 0 || x === sx + 1 || y === sy + 1 || z === sz + 1;
    if (!shell) return 0;
    const lx = x - 1, ly = y - 1, lz = z - 1;
    let cover = false;
    if (part === 'head') {
      cover = ly >= 3 && !(lz === sz && ly < 6 && lx >= 1 && lx <= 6) && y !== 0; // open face
      if (lz === sz && ly === 6) cover = true;
    } else if (part === 'torso') cover = y !== 0 || true;
    else if (part === 'armL' || part === 'armR') cover = ly >= 6;
    else cover = ly >= 4 || ly <= 2; // leggings + boots
    if (!cover) return 0;
    if (tier.holes && (x + y + z) % 2 === 0 && part !== 'head') return 0;
    const h = hash3(x, y, z, 40 + part.length);
    let c = h < 0.18 ? light : h > 0.85 ? dark : base;
    // bevel highlight on the top rows, darker trim at the bottom edge
    if (y === sy + 1 || (part === 'torso' && ly === sy - 1)) c = light;
    if (y === 0 && part !== 'torso') c = dark;
    if (part === 'torso' && lz === sz && lx >= 3 && lx <= 4 && ly >= 2 && ly <= 9) c = shade(c, 0.8); // centre seam
    if (tier.patina && vnoise(x * 0.6, y * 0.6, z * 0.6, 41) > tier.patinaAmt) c = arr(tier.patina);
    if (tier.id === 'obsidian' && hash3(x, y, z, 42) < 0.07) c = arr([150, 90, 230]);
    if (part === 'legL' || part === 'legR') if (ly <= 2) c = shade(c, 0.85);
    return c;
  }, pv);
}

export function buildHeroModels(tier) {
  const out = {};
  for (const p of Object.keys(HERO_PARTS)) out[p] = { body: heroBody(p), armor: tier ? heroArmor(p, tier) : null };
  return out;
}

// ------------------------------------------------------------------ golem
export const GVS = 1 / 8;
export const GOLEM = {
  upper: 1.875, lower: 1.875, thigh: 1.375, shin: 1.375, ankle: 0.3,
  shoulder: [1.18, 1.92, 0.0], hip: [0.48, -0.05, 0], neck: [0, 2.2, 0.05],
};
const MOSS = [[150, 168, 128], [138, 158, 118], [162, 176, 136], [128, 148, 110], [170, 182, 140]];
const MOSSDK = [[96, 122, 80], [86, 112, 72], [106, 132, 86]];
const ROCK = [[78, 80, 76], [68, 70, 68], [88, 90, 86]];

function mossy(x, y, z, s, sc = 0.55) {
  const n = vnoise(x * sc, y * sc, z * sc, s);
  const h = hash3(x, y, z, s + 1);
  if (n > 0.66) return pickC(MOSSDK, h);
  return pickC(MOSS, h);
}

export function buildGolemModels() {
  const M = {};
  // torso: ribbed chest, hunched back plate
  M.torso = voxModel(16, 18, 9, GVS, (x, y, z) => {
    const cx = x - 7.5;
    // taper toward the waist
    const half = 5 + (y / 17) * 3;
    if (Math.abs(cx) > half) return 0;
    const back = z <= 2, front = z >= 7;
    if (front && y < 15 && y > 2 && Math.abs(cx) < half - 1 && (x % 3 === 0)) return pickC(ROCK, hash3(x, y, z, 50)); // rib grooves
    if (front && y < 15 && y > 2 && Math.abs(cx) < half - 1 && z === 8 && x % 3 !== 0) return mossy(x, y, z, 51);
    if (z === 8 && (y >= 15 || y <= 2)) return 0;
    if (back && y > 12 && Math.abs(cx) < 4 && z === 0) return pickC(MOSSDK, hash3(x, y, z, 52));
    return mossy(x, y, z, 53);
  }, [8, 0, 4.5]);
  M.pelvis = voxModel(12, 5, 7, GVS, (x, y, z) => (y < 2 && (x < 2 || x > 9) ? 0 : (y === 0 ? pickC(ROCK, hash3(x, y, z, 54)) : mossy(x, y, z, 55))), [6, 5, 3.5]);
  M.head = voxModel(10, 9, 9, GVS, (x, y, z) => {
    const front = z === 8, f2 = z === 7;
    // two deep eye sockets and a mouth slit
    const eye = y >= 4 && y <= 5 && ((x >= 1 && x <= 3) || (x >= 6 && x <= 8));
    if ((front || f2) && eye) return 0;
    if (front && y === 2 && x >= 2 && x <= 7) return pickC(ROCK, hash3(x, y, z, 56));
    if (front && y === 1 && (x === 2 || x === 4 || x === 5 || x === 7)) return 0; // teeth gaps
    if (y === 8 && (x === 0 || x === 9 || z === 0)) return 0;
    if (y >= 6 && front && x >= 3 && x <= 6) return pickC(MOSSDK, hash3(x, y, z, 57)); // brow
    return mossy(x, y, z, 58);
  }, [5, 0, 4.5]);
  // eyes as separate glowing geometry
  M.eyes = voxModel(10, 9, 9, GVS, (x, y, z) => (z === 6 && y >= 4 && y <= 5 && ((x >= 1 && x <= 3) || (x >= 6 && x <= 8)) ? rgb(255, 255, 255) : 0), [5, 0, 4.5]);
  const limb = (w, len, s, coreDark) => voxModel(w, len, w, GVS, (x, y, z) => {
    const edge = x === 0 || z === 0 || x === w - 1 || z === w - 1;
    // armour plates with gaps: segments with a dark stone core showing between them
    const seg = Math.floor(y / 5);
    const gap = y % 5 === 0 && y > 0;
    if (gap && edge) return pickC(ROCK, hash3(x, y, z, s));
    if (coreDark && edge && (x === 0 || x === w - 1) && (z === 0 || z === w - 1) && hash3(x, seg, z, s + 3) < 0.4) return 0;
    return mossy(x, y + seg * 7, z, s + 1);
  }, [w / 2, len, w / 2]);
  M.upper = limb(5, 15, 60, true);
  M.lower = limb(5, 15, 62, true);
  M.thigh = limb(6, 11, 64, true);
  M.shin = limb(5, 11, 66, true);
  M.hand = voxModel(7, 7, 6, GVS, (x, y, z) => {
    if (y >= 3) return mossy(x, y, z, 68);
    // three claw fingers + thumb
    if ((x === 0 || x === 3 || x === 6) && z >= 1 && z <= 3) return pickC(y === 0 ? ROCK : MOSSDK, hash3(x, y, z, 69));
    if (z === 5 && x >= 2 && x <= 4 && y >= 1) return mossy(x, y, z, 70);
    return 0;
  }, [3.5, 7, 3]);
  M.foot = voxModel(7, 3, 10, GVS, (x, y, z) => (y === 2 && (z < 2 || z > 7) ? 0 : (z >= 8 && (x === 1 || x === 5) && y === 0 ? 0 : mossy(x, y, z, 72))), [3.5, 3, 3.5]);
  return M;
}
