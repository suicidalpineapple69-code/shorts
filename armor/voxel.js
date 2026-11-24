// Voxel grid + chunked face-culled mesher with per-vertex ambient occlusion.
// Colours are packed 0xRRGGBB with bit 24 set for "solid", so 0 means air.
import * as THREE from 'three';

export const SOLID = 1 << 24;
export const rgb = (r, g, b) => SOLID | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
export const shade = (c, k) => rgb(Math.min(255, ((c >> 16) & 255) * k), Math.min(255, ((c >> 8) & 255) * k), Math.min(255, (c & 255) * k));
export const mix = (a, b, k) => rgb(
  ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k,
  ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k,
  (a & 255) * (1 - k) + (b & 255) * k,
);
export const arr = (c) => rgb(c[0], c[1], c[2]);

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x, y, z, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// smooth value noise in 2D / 3D
export function vnoise(x, y, z = 0, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const h = hash3(xi + i, yi + j, zi + k, s);
    r += h * (i ? u : 1 - u) * (j ? v : 1 - v) * (k ? w : 1 - w);
  }
  return r;
}

const FACES = [
  // normal, the four corners (unit cube), the two in-plane axes used for AO
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const AO_CURVE = [0.42, 0.62, 0.82, 1.0];
// vertex colours are authored in sRGB, the renderer works in linear light
const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const FACE_SHADE = [0.86, 0.86, 1.0, 0.62, 0.93, 0.8];

export class Grid {
  constructor(nx, ny, nz, vs, origin = [0, 0, 0]) {
    this.nx = nx; this.ny = ny; this.nz = nz; this.vs = vs; this.origin = origin;
    this.c = new Uint32Array(nx * ny * nz);
  }
  idx(x, y, z) { return (y * this.nz + z) * this.nx + x; }
  inside(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz; }
  get(x, y, z) { return this.inside(x, y, z) ? this.c[this.idx(x, y, z)] : 0; }
  set(x, y, z, v) { if (this.inside(x, y, z)) this.c[this.idx(x, y, z)] = v; }
  // world <-> voxel
  vx(wx) { return Math.floor((wx - this.origin[0]) / this.vs); }
  vy(wy) { return Math.floor((wy - this.origin[1]) / this.vs); }
  vz(wz) { return Math.floor((wz - this.origin[2]) / this.vs); }
  solidAt(wx, wy, wz) { return this.get(this.vx(wx), this.vy(wy), this.vz(wz)) !== 0; }
  center(x, y, z) {
    const s = this.vs, o = this.origin;
    return [o[0] + (x + 0.5) * s, o[1] + (y + 0.5) * s, o[2] + (z + 0.5) * s];
  }

  // mesh the voxels in [x0,x1) x [y0,y1) x [z0,z1). Positions are in grid-local units * vs + offset.
  mesh(x0, y0, z0, x1, y1, z1, offset = this.origin, aoOn = true) {
    const pos = [], nor = [], col = [], idx = [];
    const s = this.vs;
    let vcount = 0;
    for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const c = this.c[this.idx(x, y, z)];
      if (!c) continue;
      const r = LIN[(c >> 16) & 255], g = LIN[(c >> 8) & 255], b = LIN[c & 255];
      for (let f = 0; f < 6; f++) {
        const F = FACES[f];
        const [nx, ny, nz] = F.n;
        if (this.get(x + nx, y + ny, z + nz)) continue;
        const ao = [];
        for (const cc of F.c) {
          if (!aoOn) { ao.push(3); continue; }
          // the two edge neighbours and the corner neighbour, in the layer the face looks into
          const dx = cc[0] * 2 - 1, dy = cc[1] * 2 - 1, dz = cc[2] * 2 - 1;
          const ax = nx ? 0 : dx, ay = ny ? 0 : dy, az = nz ? 0 : dz;
          const bx = x + nx, by = y + ny, bz = z + nz;
          let s1, s2;
          if (nx) { s1 = this.get(bx, by + ay, bz) ? 1 : 0; s2 = this.get(bx, by, bz + az) ? 1 : 0; }
          else if (ny) { s1 = this.get(bx + ax, by, bz) ? 1 : 0; s2 = this.get(bx, by, bz + az) ? 1 : 0; }
          else { s1 = this.get(bx + ax, by, bz) ? 1 : 0; s2 = this.get(bx, by + ay, bz) ? 1 : 0; }
          const cr = this.get(bx + ax, by + ay, bz + az) ? 1 : 0;
          ao.push(s1 && s2 ? 0 : 3 - (s1 + s2 + cr));
        }
        const fs = FACE_SHADE[f];
        for (let k = 0; k < 4; k++) {
          const cc = F.c[k];
          pos.push(offset[0] + (x + cc[0]) * s, offset[1] + (y + cc[1]) * s, offset[2] + (z + cc[2]) * s);
          nor.push(nx, ny, nz);
          const a = AO_CURVE[ao[k]] * fs;
          col.push(r * a, g * a, b * a);
        }
        // flip the quad diagonal so AO interpolates without the classic anisotropy
        if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
        else idx.push(vcount + 1, vcount + 2, vcount + 3, vcount + 1, vcount + 3, vcount);
        vcount += 4;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    return geo;
  }

  // solid voxels that touch air, as [x,y,z,colour]
  surface() {
    const out = [];
    for (let y = 0; y < this.ny; y++) for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const c = this.c[this.idx(x, y, z)];
      if (!c) continue;
      if (!this.get(x + 1, y, z) || !this.get(x - 1, y, z) || !this.get(x, y + 1, z) || !this.get(x, y - 1, z) || !this.get(x, y, z + 1) || !this.get(x, y, z - 1)) out.push([x, y, z, c]);
    }
    return out;
  }
}

// A world grid split into chunks that remesh when touched.
export class ChunkedWorld {
  constructor(grid, material, parent, cs = 16) {
    this.g = grid; this.cs = cs; this.mat = material; this.parent = parent;
    this.cx = Math.ceil(grid.nx / cs); this.cy = Math.ceil(grid.ny / cs); this.cz = Math.ceil(grid.nz / cs);
    this.meshes = new Array(this.cx * this.cy * this.cz).fill(null);
    this.dirty = new Set();
    for (let i = 0; i < this.meshes.length; i++) this.dirty.add(i);
  }
  markVoxel(x, y, z) {
    const cs = this.cs;
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      const X = Math.floor((x + dx) / cs), Y = Math.floor((y + dy) / cs), Z = Math.floor((z + dz) / cs);
      if (X < 0 || Y < 0 || Z < 0 || X >= this.cx || Y >= this.cy || Z >= this.cz) continue;
      this.dirty.add((Y * this.cz + Z) * this.cx + X);
    }
  }
  markAll() { for (let i = 0; i < this.meshes.length; i++) this.dirty.add(i); }
  flush() {
    const cs = this.cs, g = this.g;
    for (const i of this.dirty) {
      const X = i % this.cx, Z = Math.floor(i / this.cx) % this.cz, Y = Math.floor(i / (this.cx * this.cz));
      const geo = g.mesh(X * cs, Y * cs, Z * cs, Math.min(g.nx, X * cs + cs), Math.min(g.ny, Y * cs + cs), Math.min(g.nz, Z * cs + cs));
      let m = this.meshes[i];
      if (!m) {
        m = new THREE.Mesh(geo, this.mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.matrixAutoUpdate = false;
        this.parent.add(m);
        this.meshes[i] = m;
      } else {
        m.geometry.dispose();
        m.geometry = geo;
      }
      m.visible = geo.index.count > 0;
    }
    this.dirty.clear();
  }
}

// Small model: a voxel box filled by fn(x,y,z) -> colour|0, meshed around a pivot (in voxels).
export function voxModel(sx, sy, sz, vs, fn, pivot = [sx / 2, sy, sz / 2]) {
  const g = new Grid(sx, sy, sz, vs);
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const c = fn(x, y, z);
    if (c) g.set(x, y, z, c);
  }
  const off = [-pivot[0] * vs, -pivot[1] * vs, -pivot[2] * vs];
  const geo = g.mesh(0, 0, 0, sx, sy, sz, off);
  // surface voxels in model space (centre positions) for shattering
  const vox = g.surface().map(([x, y, z, c]) => [off[0] + (x + 0.5) * vs, off[1] + (y + 0.5) * vs, off[2] + (z + 0.5) * vs, c]);
  return { geo, vox, vs, size: [sx * vs, sy * vs, sz * vs], center: [off[0] + sx * vs / 2, off[1] + sy * vs / 2, off[2] + sz * vs / 2] };
}
