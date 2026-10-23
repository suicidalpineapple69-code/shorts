// Procedural 16x16 pixel-art textures. Everything is drawn from seeded noise,
// no game assets are used.
import * as THREE from 'three';
import { rng } from './world.js';

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const pick = (r, list) => list[Math.floor(r() * list.length)];
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k, c[3] ?? 255];

function paint(size, seed, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const r = rng(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const p = fn(x, y, r);
      const i = (y * size + x) * 4;
      img.data[i] = clamp(p[0]);
      img.data[i + 1] = clamp(p[1]);
      img.data[i + 2] = clamp(p[2]);
      img.data[i + 3] = clamp(p[3] ?? 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// copy a canvas and paint over it
function over(base, seed, fn) {
  const size = base.width;
  const src = base.getContext('2d').getImageData(0, 0, size, size).data;
  return paint(size, seed, (x, y, r) => {
    const i = (y * size + x) * 4;
    const cur = [src[i], src[i + 1], src[i + 2], src[i + 3]];
    return fn(x, y, r, cur) || cur;
  });
}

const vary = (r, c, a = 0.08) => mul(c, 1 - a + r() * 2 * a);

const GRASS = [[86, 140, 52], [98, 152, 58], [74, 124, 46], [108, 162, 64], [90, 146, 54]];
const DIRT = [[134, 96, 67], [121, 85, 58], [146, 106, 74], [108, 76, 52], [128, 92, 63]];

function cobblePattern(seed, size = 16) {
  const r = rng(seed);
  const pts = Array.from({ length: 9 }, () => [r() * size, r() * size, 0.8 + r() * 0.35]);
  return (x, y) => {
    let d1 = 1e9, d2 = 1e9, best = null;
    for (const p of pts) {
      for (let ox = -size; ox <= size; ox += size) for (let oy = -size; oy <= size; oy += size) {
        const d = Math.hypot(x + 0.5 - p[0] - ox, y + 0.5 - p[1] - oy);
        if (d < d1) { d2 = d1; d1 = d; best = [p, ox, oy]; } else if (d < d2) d2 = d;
      }
    }
    const [p, ox, oy] = best;
    const lit = ((p[0] + ox) - x + (p[1] + oy) - y) * 0.035;
    return { edge: d2 - d1 < 1.15, tone: p[2] + lit };
  };
}

function face(x, y, rects) {
  return rects.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1);
}

export function makeTextures() {
  const C = {};
  C.grass_top = paint(16, 1, (x, y, r) => vary(r, pick(r, GRASS), 0.06));
  C.dirt = paint(16, 2, (x, y, r) => (r() < 0.06 ? [92, 64, 44] : vary(r, pick(r, DIRT), 0.05)));
  C.grass_side = over(C.dirt, 3, (x, y, r) => {
    const depth = 3 + ((x * 7 + 3) % 3 === 0 ? 1 : 0) + ((x * 5 + 1) % 4 === 0 ? 1 : 0);
    if (y < depth) return vary(r, pick(r, GRASS), 0.05);
  });
  C.path_top = paint(16, 4, (x, y, r) => vary(r, pick(r, [[148, 120, 78], [136, 108, 70], [158, 128, 84], [126, 100, 64]]), 0.04));
  C.gravel = paint(16, 5, (x, y, r) => vary(r, pick(r, [[136, 128, 124], [112, 104, 100], [150, 140, 134], [96, 88, 84], [124, 112, 100]]), 0.06));
  C.stone = paint(16, 6, (x, y, r) => (r() < 0.07 ? [104, 104, 104] : vary(r, [126, 126, 126], 0.07)));
  const cp = cobblePattern(7);
  C.cobble = paint(16, 7, (x, y, r) => {
    const c = cp(x, y);
    return c.edge ? vary(r, [72, 72, 74], 0.08) : vary(r, mul([128, 128, 130], c.tone), 0.05);
  });
  C.mossy = over(C.cobble, 8, (x, y, r, cur) => {
    const m = Math.sin(x * 0.9 + y * 0.4) + Math.cos(y * 1.1 - x * 0.3) + r() * 0.9;
    if (m > 1.0) return vary(r, pick(r, [[78, 110, 48], [92, 124, 56], [66, 96, 40]]), 0.05);
  });
  C.bricks = paint(16, 9, (x, y, r) => {
    const row = y < 8 ? 0 : 1;
    const yy = y % 8;
    const mortar = yy === 7 || (row === 0 ? x === 15 : x === 7 || x === 15);
    if (mortar) return vary(r, [78, 76, 78], 0.05);
    const hi = yy === 0 || (row === 0 ? x === 0 : x === 0 || x === 8);
    return vary(r, hi ? [146, 144, 146] : [122, 120, 122], 0.06);
  });
  C.oak_log = paint(16, 10, (x, y, r) => vary(r, [[109, 85, 50], [96, 74, 44], [120, 94, 56], [86, 66, 40]][(x * 3 + (x >> 2)) % 4], 0.06));
  const rings = (bark, a, b) => (x, y, r) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.6) return vary(r, bark, 0.06);
    return vary(r, Math.floor(d) % 2 ? a : b, 0.04);
  };
  C.oak_log_top = paint(16, 11, rings([96, 74, 44], [176, 140, 90], [150, 118, 74]));
  C.dark_log = paint(16, 12, (x, y, r) => vary(r, [[62, 47, 31], [50, 38, 24], [72, 55, 35], [44, 33, 21]][(x * 3 + (x >> 2) + (y > 9 ? 1 : 0)) % 4], 0.07));
  C.dark_log_top = paint(16, 13, rings([52, 39, 25], [104, 79, 48], [86, 64, 39]));
  const planks = (base, seam, seed) => {
    const r0 = rng(seed);
    const tints = [0.95 + r0() * 0.1, 0.95 + r0() * 0.1, 0.95 + r0() * 0.1, 0.95 + r0() * 0.1];
    const joint = [Math.floor(r0() * 16), Math.floor(r0() * 16), Math.floor(r0() * 16), Math.floor(r0() * 16)];
    return paint(16, seed, (x, y, r) => {
      const p = y >> 2;
      if (y % 4 === 3 || x === joint[p]) return vary(r, seam, 0.04);
      const grain = Math.sin(x * 0.8 + p * 2) * 0.04;
      return vary(r, mul(base, tints[p] + grain), 0.04);
    });
  };
  C.spruce = planks([116, 86, 52], [78, 56, 33], 14);
  C.dark_planks = planks([70, 46, 23], [42, 27, 12], 15);
  C.roof = paint(16, 16, (x, y, r) => {
    const tx = Math.floor((x + (y >> 2) % 2 * 2) / 4), ty = y >> 2;
    if (y % 4 === 3 || (x + (ty % 2) * 2) % 4 === 3) return vary(r, [30, 30, 38], 0.05);
    const k = 0.9 + ((tx * 7 + ty * 13) % 5) * 0.04;
    return vary(r, mul([64, 62, 76], k), 0.05);
  });
  C.glass = paint(16, 17, (x, y, r) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return [206, 226, 232, 255];
    if ((x === y + 2 || x === y + 3) && x > 3 && x < 9) return [255, 255, 255, 150];
    return [200, 225, 235, 38];
  });
  const windowPx = (x, y, r, lit) => {
    if (x === 0 || y === 0 || x === 15 || y === 15) return lit ? [0, 0, 0] : [62, 41, 22];
    if (x === 7 || x === 8 || y === 7 || y === 8) return lit ? [0, 0, 0] : [56, 37, 20];
    const g = y / 15;
    const c = [255, 216 - 50 * g, 120 - 50 * g];
    return lit ? mul(c, 0.95 + r() * 0.1) : vary(r, c, 0.04);
  };
  C.window = paint(16, 18, (x, y, r) => windowPx(x, y, r, false));
  C.window_e = paint(16, 18, (x, y, r) => windowPx(x, y, r, true));
  const door = (top, lit) => paint(16, top ? 19 : 20, (x, y, r) => {
    const frame = x <= 1 || x >= 14 || (top ? y <= 1 : y >= 14);
    if (top && x >= 3 && x <= 12 && y >= 3 && y <= 9 && x !== 7 && x !== 8) {
      const c = [255, 196, 96];
      return lit ? c : vary(r, c, 0.03);
    }
    if (lit) return [0, 0, 0];
    if (!top && (x === 11 || x === 12) && (y === 6 || y === 7)) return [150, 150, 150];
    if (frame) return vary(r, [52, 34, 17], 0.06);
    return vary(r, (x >> 2) % 2 ? [74, 49, 25] : [66, 43, 21], 0.06);
  });
  C.door_lo = door(false, false);
  C.door_hi = door(true, false);
  C.door_hi_e = door(true, true);
  C.leaves = paint(16, 21, (x, y, r) => (r() < 0.18 ? [0, 0, 0, 0] : vary(r, pick(r, [[44, 86, 32], [52, 100, 38], [36, 72, 27]]), 0.06)));
  C.spruce_leaves = paint(16, 22, (x, y, r) => (r() < 0.14 ? [0, 0, 0, 0] : vary(r, pick(r, [[34, 58, 38], [42, 70, 46], [27, 48, 31]]), 0.06)));
  C.vine = paint(16, 23, (x, y, r) => (r() < 0.22 ? [0, 0, 0, 0] : vary(r, pick(r, [[64, 124, 40], [78, 140, 48], [54, 104, 34]]), 0.06)));
  const pumpkinRib = (x, y, r) => {
    const g = x % 5 === 0;
    const hl = x % 5 === 2;
    return vary(r, g ? [178, 96, 22] : hl ? [244, 158, 46] : [226, 136, 32], 0.05);
  };
  C.pumpkin_side = paint(16, 24, (x, y, r) => (y === 0 || y === 15 ? vary(r, [190, 104, 24], 0.04) : pumpkinRib(x, y, r)));
  C.pumpkin_top = paint(16, 25, (x, y, r) => {
    if (x >= 6 && x <= 9 && y >= 6 && y <= 9) return vary(r, [96, 82, 32], 0.08);
    const ray = (Math.abs(x - 7.5) < 0.6 || Math.abs(y - 7.5) < 0.6 || Math.abs(Math.abs(x - 7.5) - Math.abs(y - 7.5)) < 0.6);
    return vary(r, ray ? [192, 106, 24] : [222, 132, 30], 0.05);
  });
  const carved = (x, y) => face(x, y, [[2, 4, 5, 5], [3, 3, 4, 3], [10, 4, 13, 5], [11, 3, 12, 3], [7, 7, 8, 8],
    [2, 10, 13, 11], [3, 12, 12, 12], [2, 9, 2, 9], [13, 9, 13, 9]]) && !face(x, y, [[5, 10, 5, 10], [10, 12, 10, 12]]);
  C.jack_face = over(C.pumpkin_side, 26, (x, y, r) => (carved(x, y) ? vary(r, [255, 220, 92], 0.05) : null));
  C.jack_face_e = paint(16, 26, (x, y) => (carved(x, y) ? [255, 190, 70] : [0, 0, 0]));
  C.shell = paint(16, 27, (x, y, r) => {
    if (x === 0 || y === 0) return vary(r, [204, 116, 28], 0.04);
    return vary(r, (x + y * 3) % 7 === 0 ? [236, 146, 40] : [228, 136, 34], 0.05);
  });
  const glowPx = (x, y, r) => pick(r, [[255, 200, 84], [255, 220, 120], [250, 176, 64], [255, 210, 96], [236, 150, 52]]);
  C.glow = paint(16, 28, glowPx);
  C.glow_e = paint(16, 28, glowPx);
  C.stem = paint(16, 29, (x, y, r) => vary(r, [[92, 110, 42], [78, 94, 34], [104, 122, 50]][(x * 5 + (y >> 3)) % 3], 0.06));
  C.stem_top = paint(16, 30, rings([78, 94, 34], [126, 140, 66], [108, 122, 54]));
  C.hay_side = paint(16, 31, (x, y, r) => (y === 3 || y === 4 || y === 11 || y === 12 ? vary(r, [128, 60, 26], 0.06) : vary(r, x % 3 ? [214, 182, 66] : [186, 152, 48], 0.06)));
  C.hay_top = paint(16, 32, (x, y, r) => vary(r, (x + y) % 4 ? [214, 182, 66] : [176, 142, 44], 0.07));
  const lantern = (core, lit) => paint(16, 33, (x, y, r) => {
    const edge = x <= 1 || x >= 14 || y <= 1 || y >= 14 || x === 7 || x === 8;
    if (edge) return lit ? [0, 0, 0] : vary(r, [50, 50, 58], 0.08);
    const d = Math.hypot(x - 7.5, y - 8);
    const c = d < 3.5 ? [255, 250, 220] : core;
    return lit ? c : vary(r, c, 0.04);
  });
  C.lantern = lantern([255, 196, 92], false);
  C.lantern_e = lantern([255, 186, 80], true);
  C.soul_lantern = lantern([110, 226, 255], false);
  C.soul_lantern_e = lantern([96, 214, 255], true);
  C.torch = paint(16, 34, (x, y, r) => (y < 4 ? vary(r, [255, 226, 120], 0.05) : vary(r, [112, 82, 46], 0.08)));
  C.torch_e = paint(16, 34, (x, y) => (y < 4 ? [255, 210, 110] : [0, 0, 0]));
  C.cobweb = paint(16, 35, (x, y) => {
    const dx = x - 7.5, dy = y - 7.5;
    const on = Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6 || Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.6 ||
      [3, 6].some((k) => Math.abs(Math.max(Math.abs(dx), Math.abs(dy)) - k) < 0.5);
    return on ? [228, 228, 234, 235] : [0, 0, 0, 0];
  });
  C.tall_grass = paint(16, 36, (x, y, r) => {
    const blade = [1, 3, 4, 6, 8, 9, 11, 13, 14].includes(x) && y > [6, 3, 8, 2, 5, 9, 4, 7, 10][[1, 3, 4, 6, 8, 9, 11, 13, 14].indexOf(x)];
    return blade ? vary(r, pick(r, [[180, 196, 170], [200, 214, 188], [160, 178, 150]]), 0.05) : [0, 0, 0, 0];
  });
  C.dead_bush = paint(16, 37, (x, y) => {
    const twig = (Math.abs(x - 7.5) < 0.6 && y > 8) || Math.abs((15 - y) - Math.abs(x - 7.5) * 1.4) < 0.7 && y > 2 && y < 14;
    return twig ? [120, 86, 50, 255] : [0, 0, 0, 0];
  });
  C.tomb = paint(16, 38, (x, y, r) => {
    if (x === 0 || x === 15 || y === 0) return vary(r, [110, 110, 112], 0.04);
    if ((x === 7 || x === 8) && y >= 3 && y <= 11) return vary(r, [84, 84, 88], 0.04);
    if (y === 5 && x >= 5 && x <= 10) return vary(r, [84, 84, 88], 0.04);
    if (y > 12 && r() < 0.5) return vary(r, [86, 112, 56], 0.06);
    return vary(r, [146, 146, 150], 0.04);
  });
  C.iron = paint(16, 39, (x, y, r) => vary(r, [58, 58, 66], 0.08));

  const moon = (pumpkin) => paint(32, pumpkin ? 41 : 40, (x, y, r) => {
    if (x < 2 || y < 2 || x > 29 || y > 29) return [0, 0, 0, 0];
    if (!pumpkin) {
      const crater = [[9, 10, 3], [20, 8, 2], [18, 20, 4], [8, 22, 2], [24, 24, 1.6]].some(([cx, cy, cr]) => Math.hypot(x - cx, y - cy) < cr);
      return crater ? vary(r, [200, 204, 196], 0.03) : vary(r, [236, 238, 226], 0.025);
    }
    const eyes = face(x, y, [[6, 10, 12, 12], [7, 8, 11, 9], [8, 6, 10, 7], [19, 10, 25, 12], [20, 8, 24, 9], [21, 6, 23, 7]]);
    const nose = face(x, y, [[15, 14, 16, 16]]);
    // grin: corners higher than the middle (canvas y grows downwards)
    const dx = x - 15.5;
    const mid = 22.5 - 0.045 * dx * dx;
    const mouth = Math.abs(dx) <= 10 && y >= mid - 1.6 - 0.02 * (100 - dx * dx) && y <= mid + 1.2 &&
      !face(x, y, [[11, 17, 12, 19], [19, 22, 20, 24]]);
    if (eyes || nose || mouth) return [255, 236, 130];
    return vary(r, (x % 6 === 0) ? [214, 110, 26] : [246, 146, 40], 0.04);
  });
  C.moon = moon(false);
  C.moon_pumpkin = moon(true);

  const out = {};
  for (const [k, c] of Object.entries(C)) {
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    t.colorSpace = THREE.SRGBColorSpace;
    out[k] = t;
  }
  return out;
}
