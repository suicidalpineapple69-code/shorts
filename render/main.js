// Scene assembly and per-frame rendering. The page exposes init(timeline) and
// renderFrame(t); every frame is a pure function of t, so frames can be
// rendered in any order or in parallel.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TYPES, buildWorld, rng, HACK, NOOB, PRO } from './world.js';
import { makeTextures } from './textures.js';
import { makeShots, cameraAt, MOON_DIR as MOON, MOON_HIGH } from './shots.js';
import { Overlay } from './overlay.js';
import { FxShader } from './fx.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const lerp = (a, b, t) => a + (b - a) * t;
const Y = new THREE.Vector3(0, 1, 0);
const MOON_LOW = new THREE.Vector3(...MOON), MOON_UP = new THREE.Vector3(...MOON_HIGH);
const MOON_DIR = new THREE.Vector3();
// overlay layout is authored for 1080x1920
const REF_W = 1080, REF_H = 1920;

let T, W, H, renderer, scene, camera, composer, fxPass, overlay, out2d, ctx2d, shots;
let world, TEX, sky, stars, moon, moonHalo, dirLight, hemi, fireflies, dust, sparks, smoke, bolt;
let moonFlipped = false;
const dynamic = [], dynMeshes = new Set(), channels = [], bats = [], lightPool = [];
const materialCache = new Map();

async function loadFonts() {
  const list = [
    ['Pixelify', 'pixelify-sans/files/pixelify-sans-latin-700-normal.woff2', '700'],
    ['Pixelify', 'pixelify-sans/files/pixelify-sans-latin-500-normal.woff2', '500'],
    ['Luckiest', 'luckiest-guy/files/luckiest-guy-latin-400-normal.woff2', '400'],
    ['PressStart', 'press-start-2p/files/press-start-2p-latin-400-normal.woff2', '400'],
  ];
  for (const [family, file, weight] of list) {
    const f = new FontFace(family, `url(/node_modules/@fontsource/${file})`, { weight });
    await f.load();
    document.fonts.add(f);
  }
  await document.fonts.load('100px "Noto Color Emoji"', '👇');
}

// ------------------------------------------------------------------ geometry

// Box with block-aligned UVs (partial blocks show the matching part of the
// texture, like the game). full=true keeps a whole texture per face instead.
function boxGeo(x0, y0, z0, x1, y1, z1, full = false) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  if (full) return g;
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + 0.5, y = p.getY(i) + 0.5, z = p.getZ(i) + 0.5;
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    if (Math.abs(nx) > 0.5) uv.setXY(i, nx > 0 ? 1 - z : z, y);
    else if (Math.abs(ny) > 0.5) uv.setXY(i, x, ny > 0 ? 1 - z : z);
    else uv.setXY(i, nz > 0 ? x : 1 - x, y);
  }
  return g;
}

const SHAPES = {
  cube: () => boxGeo(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5),
  slab: () => boxGeo(-0.5, -0.5, -0.5, 0.5, 0, 0.5),
  stairs: () => mergeGeometries([boxGeo(-0.5, -0.5, -0.5, 0.5, 0, 0.5), boxGeo(-0.5, 0, -0.5, 0.5, 0.5, 0)]),
  door: () => boxGeo(-0.5, -0.5, 0.31, 0.5, 0.5, 0.5),
  lantern: () => mergeGeometries([boxGeo(-0.19, -0.5, -0.19, 0.19, -0.06, 0.19, true), boxGeo(-0.125, -0.06, -0.125, 0.125, 0.04, 0.125)]),
  lantern_hang: () => mergeGeometries([boxGeo(-0.19, -0.22, -0.19, 0.19, 0.22, 0.19, true), boxGeo(-0.04, 0.22, -0.04, 0.04, 0.5, 0.04)]),
  torch: () => boxGeo(-0.0625, -0.5, -0.0625, 0.0625, 0.125, 0.0625, true),
  post: () => boxGeo(-0.125, -0.5, -0.125, 0.125, 0.5, 0.125),
  rail_x: () => mergeGeometries([boxGeo(0, 0, -0.0625, 1, 0.12, 0.0625), boxGeo(0, -0.32, -0.0625, 1, -0.2, 0.0625)]),
  rail_z: () => mergeGeometries([boxGeo(-0.0625, 0, 0, 0.0625, 0.12, 1), boxGeo(-0.0625, -0.32, 0, 0.0625, -0.2, 1)]),
  tomb: () => boxGeo(-0.4, -0.5, -0.11, 0.4, 0.55, 0.11, true),
  cross: () => mergeGeometries([new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 4), new THREE.PlaneGeometry(1, 1).rotateY(-Math.PI / 4)]),
};

// ----------------------------------------------------------------- materials

const EMISSIVE_BASE = { window: 1.35, hwindow: 1.2, jack: 1.6, glow: 0.95, lantern: 2.1, lantern_hang: 2.1, soul_lantern: 2.1, torch: 2.4, door_hi: 1.2, hdoor_hi: 1.3 };

function material(type, def, texName, emissiveName, vertexColors = false) {
  const key = `${type}|${texName}|${emissiveName}|${vertexColors}`;
  if (materialCache.has(key)) return materialCache.get(key);
  const m = new THREE.MeshLambertMaterial({ map: TEX[texName], vertexColors });
  if (def.alpha) m.alphaTest = 0.5;
  if (texName === 'glass') {
    m.transparent = true;
    m.alphaTest = 0.02;
    m.depthWrite = false;
  }
  if (def.shape === 'cross') m.side = THREE.DoubleSide;
  if (emissiveName) {
    m.emissive = new THREE.Color(1, 1, 1);
    m.emissiveMap = TEX[emissiveName];
    channels.push({ mat: m, channel: def.light, base: EMISSIVE_BASE[type] ?? 1.8, glow: type === 'glow' });
  }
  materialCache.set(key, m);
  return m;
}

function faceMaterial(type, role, vertexColors) {
  const def = TYPES[type], tx = def.tex, em = def.emissive || {};
  if (tx.all) return material(type, def, tx.all, em.all, vertexColors);
  const tex = tx[role] || tx.side;
  const emi = role === 'front' ? em.front || em.all : em.all;
  return material(type, def, tex, emi, vertexColors);
}

function materialsFor(type, def) {
  const perFace = (def.shape === 'cube' || def.shape === 'slab') && !def.tex.all;
  if (!perFace) return faceMaterial(type, 'side', false);
  const side = faceMaterial(type, 'side', false);
  return [side, side, faceMaterial(type, 'top', false), faceMaterial(type, 'bottom', false), def.tex.front ? faceMaterial(type, 'front', false) : side, side];
}

// ------------------------------------------------------- static world mesher

// Terrain and decoration cubes never move, so they are meshed like game chunks:
// hidden faces are dropped and each vertex gets corner ambient occlusion.
const DIRS = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const AO = [0.52, 0.68, 0.84, 1];
const SHADOW_CASTERS = new Set(['dark_log', 'spruce_leaves', 'pumpkin', 'jack']);

function buildStatic(blocks) {
  const solid = new Map();
  for (const b of blocks) solid.set(`${b.x},${b.y},${b.z}`, b);
  const at = (x, y, z) => solid.get(`${x},${y},${z}`);
  const opaque = (x, y, z) => {
    const b = at(x, y, z);
    return b && !TYPES[b.type].alpha;
  };
  const buckets = new Map();
  const R = rng(1234);
  for (const b of blocks) {
    const def = TYPES[b.type];
    const k = 0.94 + R() * 0.08;
    const frontDir = [Math.round(Math.sin((b.r || 0) * Math.PI / 2)), 0, Math.round(Math.cos((b.r || 0) * Math.PI / 2))];
    for (const d of DIRS) {
      const [nx, ny, nz] = d.n;
      const nb = at(b.x + nx, b.y + ny, b.z + nz);
      if (nb && (!TYPES[nb.type].alpha || nb.type === b.type)) continue;
      let role = ny > 0 ? 'top' : ny < 0 ? 'bottom' : 'side';
      if (def.tex.front && nx === frontDir[0] && nz === frontDir[2] && ny === 0) role = 'front';
      const mat = faceMaterial(b.type, role, true);
      if (!buckets.has(mat)) buckets.set(mat, { pos: [], nor: [], uv: [], col: [], idx: [], shadow: SHADOW_CASTERS.has(b.type) });
      const bk = buckets.get(mat);
      const cx = b.x + 0.5 + nx * 0.5, cy = b.y + 0.5 + ny * 0.5, cz = b.z + 0.5 + nz * 0.5;
      const base = bk.pos.length / 3;
      const ao = [];
      for (const [su, sv, uu, vv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
        bk.pos.push(cx + (d.u[0] * su + d.v[0] * sv) * 0.5, cy + (d.u[1] * su + d.v[1] * sv) * 0.5, cz + (d.u[2] * su + d.v[2] * sv) * 0.5);
        bk.nor.push(nx, ny, nz);
        bk.uv.push(uu, vv);
        const ox = b.x + nx, oy = b.y + ny, oz = b.z + nz;
        const s1 = opaque(ox + d.u[0] * su, oy + d.u[1] * su, oz + d.u[2] * su) ? 1 : 0;
        const s2 = opaque(ox + d.v[0] * sv, oy + d.v[1] * sv, oz + d.v[2] * sv) ? 1 : 0;
        const c = opaque(ox + d.u[0] * su + d.v[0] * sv, oy + d.u[1] * su + d.v[1] * sv, oz + d.u[2] * su + d.v[2] * sv) ? 1 : 0;
        const a = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
        ao.push(a);
        const l = AO[a] * k;
        bk.col.push(l, l, l);
      }
      // flip the quad diagonal so AO interpolates without seams
      if (ao[0] + ao[2] < ao[1] + ao[3]) bk.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      else bk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  for (const [mat, bk] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3));
    g.setIndex(bk.idx);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = bk.shadow;
    scene.add(mesh);
  }
}

// ----------------------------------------------------------- instanced blocks

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function setInst(mesh, i, b, dy = 0, s = 1, sy = s) {
  _p.set(b.x + 0.5 + (b.ox || 0), b.y + 0.5 + dy, b.z + 0.5 + (b.oz || 0));
  _q.setFromAxisAngle(Y, (b.r || 0) * (Math.PI / 2) + (b.ry || 0));
  _s.set(s, sy, s);
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(i, _m);
}

const FULL = { s: 1, sy: 1, dy: 0 };
const HIDDEN = { s: 0, sy: 0, dy: 0 };

function blockState(b, t) {
  const S = T.sections;
  if (b.group === 'hacker') {
    if (t < S.rewind[0]) return FULL;
    if (t < S.rewind[1]) {
      // rewind: the pumpkin sinks back into the ground, last block first
      const q = (t - S.rewind[0]) / (S.rewind[1] - S.rewind[0]);
      const cut = 1 - q * 1.15;
      if (b.u > cut + 0.1) return HIDDEN;
      if (b.u > cut) {
        const k = (b.u - cut) / 0.1;
        return { s: 1 - 0.6 * k, sy: 1 - 0.6 * k, dy: -8 * k };
      }
      return FULL;
    }
    if (t < b.t) return HIDDEN;
    const u = (t - b.t) / 0.5;
    if (u >= 1) return FULL;
    const e = easeOut(u);
    return { s: 0.35 + 0.65 * e, sy: 0.35 + 0.65 * e, dy: -(1 - e) * 10 };
  }
  if (b.group === 'noob' || b.group === 'pro') {
    if (t < b.t) return HIDDEN;
    if (b.anim === 'plop') {
      const u = t - b.t, fall = 0.3;
      if (u < fall) {
        const k = u / fall;
        return { s: 1, sy: 1.15, dy: 7 * (1 - k * k) };
      }
      const v = (u - fall) / 0.35;
      if (v >= 1) return FULL;
      const sq = Math.sin(v * Math.PI * 2) * 0.28 * (1 - v);
      return { s: 1 + sq * 0.5, sy: 1 - sq, dy: -sq / 2 };
    }
    const u = (t - b.t) / 0.2;
    if (u >= 1) return FULL;
    const e = Math.max(0, easeOutBack(u));
    return { s: e, sy: e, dy: (1 - easeOut(u)) * 0.45 };
  }
  return FULL;
}

function channelValue(name, t) {
  const E = T.events, S = T.sections;
  if (name === 'always') return 1;
  if (name === 'proWindows') {
    if (t < E.proLights) return 0;
    const u = t - E.proLights;
    if (u < 0.3) return [1, 0.15, 1, 0.3, 1, 1][Math.floor(u / 0.05)] ?? 1;
    return 1;
  }
  if (name === 'hackerFace') {
    if (t < S.rewind[0]) return 1;
    if (t < E.faceOn) return t < S.rewind[1] ? 1 : 0;
    const u = t - E.faceOn;
    if (u < 0.1) return 1.6 * (u / 0.1);
    return 1 + 0.6 * Math.exp(-(u - 0.1) * 4);
  }
  return 1;
}

function buildBlocks() {
  const statics = [], byType = new Map();
  for (const b of world.blocks) {
    const shape = TYPES[b.type].shape;
    if ((b.group === 'terrain' || b.group === 'decor') && shape === 'cube') {
      statics.push(b);
      continue;
    }
    if (!byType.has(b.type)) byType.set(b.type, []);
    byType.get(b.type).push(b);
  }
  buildStatic(statics);
  const geos = {};
  const R = rng(321);
  const col = new THREE.Color();
  for (const [type, list] of byType) {
    const def = TYPES[type];
    const geo = (geos[def.shape] ??= SHAPES[def.shape]());
    const mesh = new THREE.InstancedMesh(geo, materialsFor(type, def), list.length);
    mesh.frustumCulled = false;
    mesh.castShadow = def.shape !== 'cross' && type !== 'glass';
    mesh.receiveShadow = true;
    list.forEach((b, i) => {
      if (type === 'tall_grass') {
        b.ry = R() * Math.PI;
        b.ox = (R() - 0.5) * 0.3;
        b.oz = (R() - 0.5) * 0.3;
        const k = 0.85 + R() * 0.3;
        col.setRGB(0.46 * k, 0.7 * k, 0.32 * k);
      } else if (def.tint && b.shade !== undefined) {
        const k = b.shade * (0.97 + R() * 0.06);
        col.setRGB(k, k * (0.97 + R() * 0.04), k);
      } else {
        const k = 0.95 + R() * 0.08;
        col.setRGB(k, k, k);
      }
      mesh.setColorAt(i, col);
      setInst(mesh, i, b);
      if (b.group === 'noob' || b.group === 'pro' || b.group === 'hacker') {
        dynamic.push({ mesh, i, b });
        dynMeshes.add(mesh);
      }
    });
    scene.add(mesh);
  }
}

// --------------------------------------------------------------- sky & moon

function buildSky() {
  sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color('#03051a') },
      mid: { value: new THREE.Color('#151239') },
      horizon: { value: new THREE.Color('#3a2650') },
      glow: { value: new THREE.Color('#ff6a2a') },
      flash: { value: 0 },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 top, mid, horizon, glow; uniform float flash; varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(horizon, mid, smoothstep(-0.03, 0.2, h));
        c = mix(c, top, smoothstep(0.2, 0.8, h));
        c += glow * exp(-abs(h) * 14.0) * 0.16;
        c += vec3(0.5, 0.55, 0.9) * flash;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  const R = rng(77);
  const pts = [];
  while (pts.length < 900 * 3) {
    const v = new THREE.Vector3(R() * 2 - 1, R() * 2 - 1, R() * 2 - 1);
    if (v.length() > 1 || v.y < 0.06) continue;
    v.normalize().multiplyScalar(450);
    pts.push(v.x, v.y, v.z);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: new THREE.Color(1.2, 1.2, 1.3), fog: false, depthWrite: false, transparent: true, opacity: 0.85 }));
  stars.renderOrder = -9;
  scene.add(stars);

  moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: TEX.moon, transparent: true, fog: false, depthWrite: false }));
  moon.renderOrder = -8;
  scene.add(moon);
  const hc = document.createElement('canvas');
  hc.width = hc.height = 128;
  const hctx = hc.getContext('2d');
  const grad = hctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  hctx.fillStyle = grad;
  hctx.fillRect(0, 0, 128, 128);
  const haloTex = new THREE.CanvasTexture(hc);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  moonHalo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moonHalo.renderOrder = -9;
  scene.add(moonHalo);
}

const MOON_DIST = 420, MOON_SIZE = 62;

function updateSky(t) {
  MOON_DIR.copy(t < T.events.crane[0] ? MOON_UP : MOON_LOW);
  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
  moon.position.copy(camera.position).addScaledVector(MOON_DIR, MOON_DIST);
  moon.quaternion.copy(camera.quaternion);
  moonHalo.position.copy(camera.position).addScaledVector(MOON_DIR, MOON_DIST + 5);
  moonHalo.quaternion.copy(camera.quaternion);
  moonHalo.scale.setScalar(MOON_SIZE * 2.6);
  // the twist: the moon flips into a jack-o'-lantern
  const f = T.events.moonFlip;
  let sx = 1;
  if (t >= f && t < f + 0.3) sx = Math.abs(Math.cos(((t - f) / 0.3) * Math.PI));
  const flipped = t >= f + 0.15;
  if (flipped !== moonFlipped) {
    moon.material.map = flipped ? TEX.moon_pumpkin : TEX.moon;
    moon.material.needsUpdate = true;
    moonFlipped = flipped;
  }
  const g = flipped ? 1.3 + 0.3 * Math.exp(-(t - f - 0.15) * 3) : 0.95;
  moon.material.color.setRGB(g, g, g);
  moonHalo.material.color.set(flipped ? '#b0541c' : '#3d4570');
  const pop = flipped ? 1 + 0.22 * Math.exp(-(t - f - 0.15) * 5) * Math.cos((t - f - 0.15) * 16) : 1;
  moon.scale.set(MOON_SIZE * sx * pop, MOON_SIZE * pop, 1);
}

// ------------------------------------------------------------------- lights

function buildLights() {
  hemi = new THREE.HemisphereLight(new THREE.Color('#4f5aa8'), new THREE.Color('#2a1c14'), 1.35);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(new THREE.Color('#8890c0'), 0.25));
  dirLight = new THREE.DirectionalLight(new THREE.Color('#9fb2ff'), 1.55);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.bias = -0.0005;
  dirLight.shadow.normalBias = 0.035;
  scene.add(dirLight);
  scene.add(dirLight.target);

  // a small pool of point lights, re-assigned per section (shader cost grows per light)
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 10, 2);
    scene.add(l);
    lightPool.push(l);
  }
  const L = world.lights;
  const tOf = (type, group) => {
    const b = world.blocks.find((x) => x.type === type && x.group === group);
    return b ? b.t : 0;
  };
  const torchAt = tOf('torch', 'noob'), lanternAt = tOf('lantern_hang', 'pro'), soulAt = tOf('soul_lantern', 'pro');
  const postsAt = Math.max(...world.blocks.filter((b) => b.group === 'hacker' && b.type === 'jack').map((b) => b.t));
  const D = {
    torch: [L.noobTorch, '#ffa040', 6, 9, (t) => (t >= torchAt ? 1 : 0)],
    porchL: [L.porchL, '#ffb050', 6, 9, (t) => (t >= lanternAt ? 1 : 0)],
    porchR: [L.porchR, '#ffb050', 6, 9, (t) => (t >= lanternAt ? 1 : 0)],
    inside: [L.proInside, '#ff9a3c', 11, 14, (t) => channelValue('proWindows', t)],
    soul: [L.soul, '#5fd4ff', 6, 8, (t) => (t >= soulAt ? 1 : 0)],
    faceA: [L.faceA, '#ff8424', 60, 34, (t) => channelValue('hackerFace', t)],
    faceB: [L.faceB, '#ff8424', 60, 34, (t) => channelValue('hackerFace', t)],
    path: [L.hackPath, '#ffa040', 12, 12, (t) => (t < T.sections.rewind[0] || t >= postsAt ? 1 : 0)],
  };
  const S = T.sections;
  lightPool.sets = [
    [S.rewind[1], [D.faceA, D.faceB, D.path]],
    [S.pro[0], [D.torch]],
    [S.hacker[0], [D.porchL, D.porchR, D.inside, D.soul]],
    [S.cta[0], [D.faceA, D.faceB, D.path]],
    [Infinity, [D.faceA, D.faceB, D.inside, D.torch]],
  ];
}

function updateLights(t) {
  const set = lightPool.sets.find(([until]) => t < until)[1];
  lightPool.forEach((l, i) => {
    const d = set[i];
    if (!d) {
      l.intensity = 0;
      return;
    }
    const [pos, color, intensity, distance, fn] = d;
    l.position.set(...pos);
    l.color.set(color);
    l.distance = distance;
    l.intensity = intensity * fn(t);
  });
}

// ------------------------------------------------------------------ effects

function buildEffects() {
  const batMat = new THREE.MeshLambertMaterial({ color: new THREE.Color('#2b2230') });
  const R = rng(55);
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(mergeGeometries([
      new THREE.BoxGeometry(0.3, 0.34, 0.3),
      new THREE.BoxGeometry(0.08, 0.12, 0.06).translate(-0.09, 0.22, 0),
      new THREE.BoxGeometry(0.08, 0.12, 0.06).translate(0.09, 0.22, 0),
    ]), batMat);
    const wing = (sgn) => mergeGeometries([
      new THREE.BoxGeometry(0.4, 0.07, 0.34).translate(sgn * 0.2, 0, 0),
      new THREE.BoxGeometry(0.42, 0.07, 0.3).rotateZ(sgn * -0.5).translate(sgn * 0.58, -0.09, 0),
      new THREE.BoxGeometry(0.16, 0.2, 0.06).translate(sgn * 0.78, -0.22, 0),
    ]);
    const wl = new THREE.Mesh(wing(-1), batMat);
    const wr = new THREE.Mesh(wing(1), batMat);
    const pl = new THREE.Group(), pr = new THREE.Group();
    pl.position.x = -0.17;
    pr.position.x = 0.17;
    pl.add(wl);
    pr.add(wr);
    g.add(body, pl, pr);
    g.userData = { pl, pr, r: 12 + R() * 6, h: 13 + R() * 7, w: (0.55 + R() * 0.4) * (R() < 0.3 ? -1 : 1), ph: R() * 6.28, fl: 16 + R() * 6 };
    g.scale.setScalar(1.6);
    scene.add(g);
    bats.push(g);
  }

  const seeds = [];
  for (let i = 0; i < 220; i++) {
    const zone = i % 3;
    const c = zone === 0 ? [NOOB.x, NOOB.z] : zone === 1 ? [PRO.x + 3, PRO.z] : [HACK.x, HACK.z + 4];
    seeds.push([c[0] + (R() - 0.5) * 34, 0.6 + R() * 5, c[1] + (R() - 0.5) * 30, R() * 6.28, 0.4 + R() * 0.6]);
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(seeds.length * 3), 3));
  fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.15, color: new THREE.Color(2.6, 2.2, 1.0), transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  fireflies.userData.seeds = seeds;
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  dust = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.13, 0.13), new THREE.MeshLambertMaterial({ color: 0xffffff }), 1600);
  dust.frustumCulled = false;
  dust.userData.list = world.blocks.filter((b) => (b.group === 'noob' || b.group === 'pro') && b.t !== undefined).sort((a, b) => a.t - b.t);
  dust.setColorAt(0, new THREE.Color(1, 1, 1));
  scene.add(dust);

  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2400 * 3), 3));
  sgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(2400 * 3), 3));
  sparks = new THREE.Points(sgeo, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  sparks.userData.list = world.blocks.filter((b) => b.group === 'hacker').sort((a, b) => a.t - b.t);
  scene.add(sparks);

  smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshLambertMaterial({ color: new THREE.Color('#77778a'), transparent: true, opacity: 0.5, depthWrite: false }), 40);
  smoke.frustumCulled = false;
  const top = world.blocks.filter((b) => b.group === 'pro' && b.x === PRO.x + 3 && b.z === PRO.z - 2).sort((a, b) => b.y - a.y)[0];
  smoke.userData = { at: top.t + 0.3, pos: [top.x + 0.5, top.y + 1.2, top.z + 0.5] };
  scene.add(smoke);

  // lightning bolt behind the pumpkin
  const RB = rng(4242);
  const a0 = new THREE.Vector3(HACK.x - 26, 70, HACK.z - 34), a1 = new THREE.Vector3(HACK.x - 15, 0, HACK.z - 14);
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const q = new THREE.Vector3().lerpVectors(a0, a1, i / 16);
    if (i > 0 && i < 16) q.add(new THREE.Vector3((RB() - 0.5) * 6, 0, (RB() - 0.5) * 4));
    pts.push(q);
  }
  const parts = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.35, len + 0.3, 0.35).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize()));
    g.translate(a.x, a.y, a.z);
    parts.push(g);
  }
  bolt = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 10), fog: false }));
  bolt.visible = false;
  scene.add(bolt);
}

function hash(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const DUST_COLORS = { dirt: new THREE.Color('#7a5a40'), stone: new THREE.Color('#8a8a8a'), wood: new THREE.Color('#8a6a46') };

function updateEffects(t) {
  const batsOn = t < T.sections.rewind[1] || t >= T.events.faceOn - 0.4;
  const moonShot = t >= T.events.tilt[0];
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  bats.forEach((g, i) => {
    const u = g.userData;
    g.visible = batsOn;
    if (moonShot && i < 5) {
      // silhouettes flying across the moon
      const k = (t - T.events.tilt[0]) * (0.9 + 0.25 * i) - 1.2 + i * 0.55;
      g.position.copy(camera.position).addScaledVector(MOON_DIR, 60 + i * 6)
        .addScaledVector(right, (k - 1) * 9 * (i % 2 ? -1 : 1)).add(new THREE.Vector3(0, Math.sin(k * 3 + i) * 1.2 + (i - 2) * 2.2, 0));
      // wings spread towards the camera: the classic bat-against-the-moon silhouette
      g.quaternion.copy(camera.quaternion);
      g.rotateZ(Math.sin(t * 2 + i) * 0.25);
      g.scale.setScalar(3.4);
    } else {
      g.scale.setScalar(1.6);
      const a = u.ph + t * u.w;
      g.position.set(HACK.x + Math.cos(a) * u.r, u.h + Math.sin(t * 1.7 + u.ph) * 1.4, HACK.z + Math.sin(a) * u.r);
      g.rotation.set(0, -a + (u.w > 0 ? 0 : Math.PI), 0);
    }
    const flap = Math.sin(t * u.fl + u.ph) * 0.9;
    u.pl.rotation.z = flap;
    u.pr.rotation.z = -flap;
  });

  const fpos = fireflies.geometry.attributes.position;
  fireflies.userData.seeds.forEach((s, i) => {
    fpos.setXYZ(i, s[0] + Math.sin(t * 0.35 * s[4] + s[3]) * 1.6, s[1] + Math.sin(t * 0.8 * s[4] + s[3] * 2) * 0.5, s[2] + Math.cos(t * 0.3 * s[4] + s[3]) * 1.6);
  });
  fpos.needsUpdate = true;
  fireflies.material.opacity = 0.75 + 0.25 * Math.sin(t * 3);

  let k = 0;
  for (const b of dust.userData.list) {
    const age = t - (b.t + 0.13);
    if (age < 0 || age > 0.5) continue;
    const n = b.group === 'noob' ? 6 : 3;
    const c = b.type === 'dirt' ? DUST_COLORS.dirt : /cobble|mossy|bricks|bars|tomb/.test(b.type) ? DUST_COLORS.stone : DUST_COLORS.wood;
    for (let j = 0; j < n && k < 1600; j++) {
      const h1 = hash(b.x * 3 + b.y, b.z + j), h2 = hash(b.z + j * 7, b.x - b.y);
      const ang = h1 * Math.PI * 2, sp = 1.2 + h2 * 2.2;
      _p.set(b.x + 0.5 + Math.cos(ang) * (0.5 + sp * age), b.y + 0.1 + 2.2 * h2 * age - 4.5 * age * age, b.z + 0.5 + Math.sin(ang) * (0.5 + sp * age));
      _s.setScalar(1 - age / 0.5);
      _m.compose(_p, _q.identity(), _s);
      dust.setMatrixAt(k, _m);
      dust.setColorAt(k, c);
      k++;
    }
  }
  _m.makeScale(0, 0, 0);
  for (let j = k; j < 1600; j++) dust.setMatrixAt(j, _m);
  dust.instanceMatrix.needsUpdate = true;
  dust.instanceColor.needsUpdate = true;

  const sp = sparks.geometry.attributes.position, sc = sparks.geometry.attributes.color;
  let m = 0;
  if (t >= T.events.hackerBuild[0] - 0.1 && t < T.events.faceOn + 1.2) {
    for (const b of sparks.userData.list) {
      const age = t - b.t;
      if (age < 0 || age > 0.9) continue;
      for (let j = 0; j < 2 && m < 2400; j++) {
        const h1 = hash(b.x + j * 13, b.y * 7 + b.z), h2 = hash(b.z * 5 + j, b.x + b.y);
        sp.setXYZ(m, b.x + 0.5 + (h1 - 0.5) * 1.6, b.y + 0.5 + age * (2 + h2 * 3), b.z + 0.5 + (h2 - 0.5) * 1.6);
        const fade = (1 - age / 0.9) * 2.4;
        if (h1 > 0.5) sc.setXYZ(m, 1.6 * fade, 0.5 * fade, 2.2 * fade);
        else sc.setXYZ(m, 0.5 * fade, 2.2 * fade, 0.8 * fade);
        m++;
      }
    }
  }
  for (let j = m; j < 2400; j++) {
    sp.setXYZ(j, 0, -100, 0);
    sc.setXYZ(j, 0, 0, 0);
  }
  sp.needsUpdate = true;
  sc.needsUpdate = true;

  const sm = smoke.userData;
  for (let i = 0; i < 40; i++) {
    const life = 4;
    let age = t - (sm.at + i * 0.2);
    if (t >= sm.at + 8) age = (t - sm.at - i * 0.2) % 8;
    if (age < 0 || age > life) {
      _m.makeScale(0, 0, 0);
      smoke.setMatrixAt(i, _m);
      continue;
    }
    const s = (0.5 + age * 0.45) * (1 - Math.pow(age / life, 3));
    _p.set(sm.pos[0] + age * 0.55 + Math.sin(i * 1.7 + age) * 0.25, sm.pos[1] + age * 1.15, sm.pos[2] + Math.cos(i * 2.3 + age) * 0.25);
    _s.setScalar(s);
    _m.compose(_p, _q.setFromAxisAngle(Y, i), _s);
    smoke.setMatrixAt(i, _m);
  }
  smoke.instanceMatrix.needsUpdate = true;
}

function lightningAmount(t) {
  let v = 0;
  for (const at of T.events.lightning) {
    const u = t - at;
    if (u < 0 || u > 0.6) continue;
    v = Math.max(v, u < 0.07 ? 1 : u < 0.12 ? 0.25 : u < 0.24 ? 0.9 : 0.9 * Math.exp(-(u - 0.24) * 9));
  }
  return v;
}

function fxAt(t) {
  const E = T.events, S = T.sections;
  const f = { flash: 0, fade: 0, rgb: 0, scan: 0, blur: 0, blurDir: [0, 1], glitch: 0, warm: 0 };
  f.flash = lightningAmount(t) * 0.3;
  if (t < 0.25) f.flash = Math.max(f.flash, 0.4 * (1 - t / 0.25));
  const fo = t - E.faceOn;
  if (fo >= 0 && fo < 0.35) f.flash = Math.max(f.flash, 0.3 * (1 - fo / 0.35));
  const mf = t - E.moonFlip;
  if (mf >= 0.1 && mf < 0.45) f.flash = Math.max(f.flash, 0.35 * (1 - (mf - 0.1) / 0.35));
  const [o0, o1] = E.flashOut;
  if (t >= o0) f.flash = Math.max(f.flash, 0.4 * clamp01((t - o0) / (o1 - o0)));
  if (t >= S.rewind[0] - 0.05 && t < S.rewind[1]) {
    const k = Math.sin(clamp01((t - S.rewind[0] + 0.05) / (S.rewind[1] - S.rewind[0] + 0.05)) * Math.PI);
    f.scan = 1;
    f.rgb = 7 * (0.4 + k);
    f.glitch = 0.5 * k + 0.2;
    f.blur = 0.012 * k;
  }
  const w = 1 - Math.abs(t - S.pro[0]) / 0.16;
  if (w > 0) {
    f.blur = Math.max(f.blur, 0.05 * w);
    f.blurDir = [1, 0];
  }
  const g = t - S.hacker[0];
  if (g >= -0.06 && g < 0.4) {
    const k = 1 - clamp01((g + 0.06) / 0.46);
    f.glitch = Math.max(f.glitch, k);
    f.rgb = Math.max(f.rgb, 14 * k);
  }
  const [c0, c1] = E.crane;
  if (t > c0 && t < c1) f.blur = Math.max(f.blur, 0.03 * Math.sin(((t - c0) / (c1 - c0)) * Math.PI));
  const [u0, u1] = E.tilt;
  if (t > u0 && t < u1) f.blur = Math.max(f.blur, 0.06 * Math.sin(((t - u0) / (u1 - u0)) * Math.PI));
  return f;
}

function fogDensity(t) {
  const S = T.sections, E = T.events;
  if (t < S.rewind[1]) return 0.0105;
  if (t < S.pro[0]) return 0.0145;
  if (t < S.hacker[0]) return 0.0115;
  if (t < E.crane[0]) return 0.0105;
  return lerp(0.0105, 0.0058, clamp01((t - E.crane[0]) / (E.crane[1] - E.crane[0])));
}

function shadowFocus(t) {
  const S = T.sections;
  if (t < S.rewind[1]) return [[HACK.x, 6, HACK.z], 26];
  if (t < S.pro[0]) return [[NOOB.x, 2, NOOB.z], 14];
  if (t < S.hacker[0]) return [[PRO.x + 3, 4, PRO.z], 20];
  if (t < T.events.crane[0]) return [[HACK.x, 6, HACK.z], 26];
  return [[0, 4, -2], 58];
}

// ---------------------------------------------------------------------- API

window.init = async (timeline, opts = {}) => {
  T = timeline;
  W = opts.width || REF_W;
  H = opts.height || REF_H;
  await loadFonts();
  renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color('#2a2046'), 0.012);
  camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 1200);
  TEX = makeTextures();
  world = buildWorld(T);
  buildBlocks();
  buildSky();
  buildLights();
  buildEffects();
  shots = makeShots(T);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.5, 0.35, 0.92));
  composer.addPass(new OutputPass());
  if (opts.aa !== false) composer.addPass(new SMAAPass());
  fxPass = new ShaderPass(FxShader);
  fxPass.uniforms.res.value = [W, H];
  composer.addPass(fxPass);

  overlay = new Overlay(T);
  out2d = document.createElement('canvas');
  out2d.width = W;
  out2d.height = H;
  ctx2d = out2d.getContext('2d');
  return { blocks: world.blocks.length, counts: world.counts };
};

const _v = new THREE.Vector3();
function project(p) {
  _v.set(p[0], p[1], p[2]).project(camera);
  if (_v.z > 1) return null;
  return [((_v.x + 1) / 2) * REF_W, ((1 - _v.y) / 2) * REF_H];
}

window.renderFrame = (t) => {
  const cam = cameraAt(shots, t);
  const sh = 0.05;
  camera.position.set(cam.pos[0] + Math.sin(t * 1.3) * sh, cam.pos[1] + Math.sin(t * 1.7 + 1) * sh, cam.pos[2] + Math.cos(t * 1.1) * sh);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
  camera.updateMatrixWorld();

  for (const d of dynamic) {
    const st = blockState(d.b, t);
    setInst(d.mesh, d.i, d.b, st.dy, st.s, st.sy);
  }
  for (const m of dynMeshes) m.instanceMatrix.needsUpdate = true;
  for (const c of channels) {
    const v = channelValue(c.channel, t);
    c.mat.emissiveIntensity = c.base * v;
    if (c.glow) {
      const k = lerp(0.14, 1, clamp01(v));
      c.mat.color.setRGB(k, k, k);
    }
  }
  const lt = lightningAmount(t);
  updateLights(t);
  hemi.intensity = 1.35 + lt * 4;
  dirLight.intensity = 1.55 + lt * 3;
  sky.material.uniforms.flash.value = lt * 0.45;
  bolt.visible = lt > 0.5;

  const [fc, ext] = shadowFocus(t);
  dirLight.target.position.set(fc[0], fc[1], fc[2]);
  dirLight.position.set(fc[0] + 34, fc[1] + 60, fc[2] + 26);
  const sc = dirLight.shadow.camera;
  sc.left = -ext;
  sc.right = ext;
  sc.top = ext;
  sc.bottom = -ext;
  sc.near = 1;
  sc.far = 200;
  sc.updateProjectionMatrix();
  scene.fog.density = fogDensity(t);

  updateSky(t);
  updateEffects(t);

  const f = fxAt(t);
  const u = fxPass.uniforms;
  u.time.value = t;
  for (const k of ['flash', 'fade', 'rgb', 'scan', 'blur', 'glitch', 'warm']) u[k].value = f[k];
  u.blurDir.value = f.blurDir;
  composer.render();

  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.drawImage(renderer.domElement, 0, 0);
  ctx2d.setTransform(W / REF_W, 0, 0, H / REF_H, 0, 0);
  const mc = camera.position.clone().addScaledVector(MOON_DIR, MOON_DIST);
  const ms = project(mc.toArray());
  const mb = project(mc.clone().addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion), -MOON_SIZE / 2).toArray());
  overlay.draw(ctx2d, t, {
    W: REF_W,
    H: REF_H,
    badgeNoob: project(world.anchors.badgeNoob),
    badgePro: project(world.anchors.badgePro),
    badgeHack: project(world.anchors.badgeHack),
    badgeMoon: ms && mb ? [ms[0], mb[1] + 80] : null,
  });
  return cam.shot;
};

window.grabFrame = (type = 'image/png', q) => out2d.toDataURL(type, q);
window.ready = true;
