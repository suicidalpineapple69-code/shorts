// Renderer for "Which Armor Will Save Him?": a Teardown-style voxel short.
// window.init(timeline, {width,height}) then window.renderFrame(t) per frame; frames can come
// in any order (the physics re-simulates from zero when time goes backwards).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ROUNDS, TIERS, LAND, GRAB, roundAt, heartsAt } from './plan.js';
import { golemKeys, cameraKeys, HOOK_CAMERA, GOLEM_HOOK, GOLEM_ROOT } from './acting.js';
import { ChunkedWorld, rgb, hash3, rng, shade } from './voxel.js';
import { buildTerrain, buildHeroModels, buildGolemModels, HERO_PARTS, HVS, GOLEM, GVS, TVS, topSolid } from './models.js';
import { Hud } from './hud.js';
import { FxShader } from '../render/fx.js';

const REF_W = 1080, REF_H = 1920;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Q = () => new THREE.Quaternion();
const AX = V(1, 0, 0), AY = V(0, 1, 0), AZ = V(0, 0, 1);
const qAxis = (axis, a) => new THREE.Quaternion().setFromAxisAngle(axis, a);

let T, W, H, renderer, scene, camera, composer, fxPass, hud, out2d, ctx2d;
let grid, pristine, world, sun, golemMeshes = {}, GM, heroes = [], parts, dust;
const GOLEM_KEYS = ROUNDS.map((R) => golemKeys(R));

// ------------------------------------------------------------------ keyframe tracks
// Cardinal spline through [t, value] keys; values are numbers or arrays; strings resolve via fn.
function track(keys, t, resolve) {
  const val = (k) => (typeof k[1] === 'string' ? resolve(k[1]) : k[1]);
  if (keys.length === 1 || t <= keys[0][0]) return val(keys[0]);
  const n = keys.length;
  if (t >= keys[n - 1][0]) return val(keys[n - 1]);
  let i = 0;
  while (i < n - 2 && t >= keys[i + 1][0]) i++;
  const t1 = keys[i][0], t2 = keys[i + 1][0];
  const p1 = val(keys[i]), p2 = val(keys[i + 1]);
  const p0 = i > 0 ? val(keys[i - 1]) : null, p3 = i + 2 < n ? val(keys[i + 2]) : null;
  const t0 = i > 0 ? keys[i - 1][0] : t1, t3 = i + 2 < n ? keys[i + 2][0] : t2;
  const u = (t - t1) / (t2 - t1), dt = t2 - t1;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const one = (a1, a2, a0, a3) => {
    const m1 = a0 === null ? 0 : (a2 - a0) / (t2 - t0);
    const m2 = a3 === null ? 0 : (a3 - a1) / (t3 - t1);
    return h00 * a1 + h10 * dt * m1 + h01 * a2 + h11 * dt * m2;
  };
  if (typeof p1 === 'number') return one(p1, p2, p0, p3);
  return p1.map((_, j) => one(p1[j], p2[j], p0 ? p0[j] : null, p3 ? p3[j] : null));
}

// ------------------------------------------------------------------ IK helpers
function boneQuat(from, to, pole) {
  const y = from.clone().sub(to).normalize();
  const z = pole.clone().addScaledVector(y, -pole.dot(y));
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function twoBone(root, target, a, b, pole) {
  const dir = target.clone().sub(root);
  let d = dir.length();
  dir.normalize();
  d = Math.min(Math.max(d, Math.abs(a - b) + 0.05), a + b - 0.02);
  const cosA = (a * a + d * d - b * b) / (2 * a * d);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const pp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = root.clone().addScaledVector(dir, a * cosA).addScaledVector(pp, a * sinA);
  const end = root.clone().addScaledVector(dir, d);
  return { elbow, end, q1: boneQuat(root, elbow, pp), q2: boneQuat(elbow, end, pp) };
}

// ------------------------------------------------------------------ golem pose (pure function of t)
const poseCache = new Map();
function golemPose(t) {
  const key = Math.round(t * 1e4);
  if (poseCache.has(key)) return poseCache.get(key);
  let keys, tau;
  const r = roundAt(t);
  if (r < 0) { keys = GOLEM_HOOK; tau = t; } else { keys = GOLEM_KEYS[r]; tau = t - ROUNDS[r].start; }
  const s = (name, def) => (keys[name] ? track(keys[name], tau) : def);
  const root = keys.root ? track(keys.root, tau) : [GOLEM_ROOT[0], GOLEM_ROOT[2]];
  const breathe = Math.sin(t * 2.4) * 0.025;
  const yaw = s('yaw', 0), hipY = s('hipY', 2.78) + breathe * 0.6, pitch = s('pitch', 0.06) + breathe, headPitch = s('headPitch', 0);
  const qYaw = qAxis(AY, yaw);
  const pelvis = V(root[0], hipY, root[1]);
  const qTorso = qYaw.clone().multiply(qAxis(AX, pitch));
  const rot = (q, x, y, z) => V(x, y, z).applyQuaternion(q);
  const out = { parts: {}, grip: {} };
  out.parts.pelvis = { pos: pelvis.clone().add(rot(qYaw, 0, 0.12, 0)), quat: qYaw };
  out.parts.torso = { pos: pelvis.clone(), quat: qTorso };
  const neck = pelvis.clone().add(rot(qTorso, ...GOLEM.neck));
  const qHead = qTorso.clone().multiply(qAxis(AX, -pitch * 0.55 + headPitch));
  out.parts.head = { pos: neck, quat: qHead };
  out.parts.eyes = out.parts.head;
  out.head = neck.clone().add(rot(qHead, 0, 0.55, 0.6));
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'P' : 'N';
    const sh = pelvis.clone().add(rot(qTorso, GOLEM.shoulder[0] * side, GOLEM.shoulder[1], GOLEM.shoulder[2]));
    const rest = () => {
      const sw = Math.sin(t * 1.9 + side) * 0.12;
      return sh.clone().add(rot(qYaw, side * 0.5, -3.3, 0.55 + sw)).toArray();
    };
    const target = V(...(keys[nm] ? track(keys[nm], tau, (k) => (k === 'rest' ? rest() : rest())) : rest()));
    const pole = rot(qYaw, side * 0.8, -0.3, -1);
    const ik = twoBone(sh, target, GOLEM.upper, GOLEM.lower, pole);
    out.parts['upper' + nm] = { pos: sh, quat: ik.q1 };
    out.parts['lower' + nm] = { pos: ik.elbow, quat: ik.q2 };
    out.parts['hand' + nm] = { pos: ik.end, quat: ik.q2 };
    out.grip[nm] = ik.end.clone().add(ik.end.clone().sub(ik.elbow).normalize().multiplyScalar(0.55));
    // legs
    const hip = pelvis.clone().add(rot(qYaw, GOLEM.hip[0] * side, GOLEM.hip[1], GOLEM.hip[2]));
    const plant = () => V(root[0], 0, root[1]).add(rot(qYaw, side * 0.58, 0, 0)).toArray();
    const fk = keys['foot' + nm];
    const sole = V(...(fk ? track(fk, tau, plant) : plant()));
    const ankle = sole.clone().add(V(0, GOLEM.ankle, 0));
    const leg = twoBone(hip, ankle, GOLEM.thigh, GOLEM.shin, rot(qYaw, 0, 0, 1));
    out.parts['thigh' + nm] = { pos: hip, quat: leg.q1 };
    out.parts['shin' + nm] = { pos: leg.elbow, quat: leg.q2 };
    out.parts['foot' + nm] = { pos: leg.end.clone().add(V(0, -GOLEM.ankle + 3 * GVS, 0)), quat: qYaw };
  }
  if (poseCache.size > 4000) poseCache.clear();
  poseCache.set(key, out);
  return out;
}

const GOLEM_PARTS = { pelvis: 'pelvis', torso: 'torso', head: 'head', eyes: 'eyes', upperP: 'upper', upperN: 'upper', lowerP: 'lower', lowerN: 'lower', handP: 'hand', handN: 'hand', thighP: 'thigh', thighN: 'thigh', shinP: 'shin', shinN: 'shin', footP: 'foot', footN: 'foot' };

// ------------------------------------------------------------------ hero pose (pure function of t)
const CHEST = 18 * HVS; // chest height above the feet
const G_THROW = 22;

function heroYaw(R) { return R.kind === 'stomp' ? 0.6 : 0.45; }

function throwPath(R) {
  if (R._throw) return R._throw;
  const t0 = R.start + R.release, hit = R.hits[0][0];
  const p0 = golemPose(t0).grip.P.clone();
  const off = R.kind === 'wall' ? 0 : 0.35;
  const p1 = V(R.target[0], R.target[1] + off, R.target[2]);
  const D = hit - R.release;
  const g = R.kind === 'sky' ? 34 : G_THROW;
  const v0 = p1.clone().sub(p0).sub(V(0, -0.5 * g * D * D, 0)).divideScalar(D);
  R._throw = { p0, v0, g, D };
  return R._throw;
}

function finalCrater(R) {
  if (R._crater) return R._crater;
  const c = heroChest(6, R.start + R.hits[0][0] - 1e-4);
  const r = craterRadius(R.hits[0][2]);
  R._crater = { c, r, floor: c.y - 0.35 - 0.75 * r };
  return R._crater;
}

// returns { mode, chest(Vector3), quat, limbs } — the hero's chest position and body orientation
function heroState(ri, t) {
  const R = ROUNDS[ri];
  const tau = t - R.start;
  const yaw = heroYaw(R);
  const qUp = qAxis(AY, yaw);
  const spawnChest = V(R.spawn[0], CHEST, R.spawn[2]);
  const limbs = { armL: [0, 0], armR: [0, 0], legL: [0, 0], legR: [0, 0], head: [0, 0] };
  const flail = (k = 1) => {
    limbs.armL = [-2.6 + Math.sin(t * 21) * 0.6 * k, 0.4];
    limbs.armR = [-2.6 + Math.sin(t * 21 + 2) * 0.6 * k, -0.4];
    limbs.legL = [Math.sin(t * 17) * 0.7 * k, 0.1];
    limbs.legR = [-Math.sin(t * 17) * 0.7 * k, -0.1];
  };
  if (tau < LAND) {
    const k = tau / LAND;
    flail(0.5);
    return { mode: 'drop', chest: spawnChest.clone().add(V(0, 8 * (1 - k * k), 0)), quat: qUp, limbs };
  }
  const lastHit = R.hits[R.hits.length - 1][0];
  if (R.kind !== 'final' && tau >= lastHit) return { mode: 'dead' };

  if (R.kind === 'stomp') {
    const S = V(R.stompAt[0], CHEST, R.stompAt[2]);
    const k = smooth((tau - 1.25) / 0.95);
    const chest = spawnChest.clone().lerp(S, k);
    const running = tau > 1.25 && tau < 2.2;
    const cyc = Math.sin(t * 18);
    if (running) {
      limbs.armL = [cyc * 1.1, 0.05]; limbs.armR = [-cyc * 1.1, -0.05];
      limbs.legL = [-cyc * 0.9, 0]; limbs.legR = [cyc * 0.9, 0];
      chest.y += Math.abs(Math.cos(t * 18)) * 0.06;
    } else if (tau >= 2.2) {
      limbs.armL = [-2.9, 0.5]; limbs.armR = [-2.9, -0.5];
      limbs.head = [-0.75, 0];
    } else {
      limbs.head = [-0.5 * smooth((tau - 0.6) / 0.4), 0];
    }
    // turns to run toward the camera, then turns back to look up at the foot
    const ry = tau < 1.25 ? yaw : tau < 2.2 ? lerp(yaw, 0.2, smooth((tau - 1.25) / 0.2)) : lerp(0.2, 0.9, smooth((tau - 2.2) / 0.15));
    return { mode: 'stand', chest, quat: qAxis(AY, ry), limbs };
  }

  if (tau < GRAB) {
    // idle, then looks up and cowers as the hand comes down
    const scare = smooth((tau - 0.55) / 0.35);
    const land = Math.max(0, 1 - (tau - LAND) / 0.18);
    limbs.head = [-0.65 * smooth((tau - 0.45) / 0.3), 0];
    limbs.armL = [lerp(Math.sin(t * 3) * 0.08, -2.4, scare), lerp(0.05, 0.5, scare)];
    limbs.armR = [lerp(-Math.sin(t * 3) * 0.08, -2.4, scare), lerp(-0.05, -0.5, scare)];
    const chest = spawnChest.clone();
    chest.y -= land * 0.12;
    return { mode: 'stand', chest, quat: qUp, limbs };
  }

  const release = R.release ?? (R.kind === 'final' ? R.hits[0][0] : lastHit);
  if (tau < release || (R.kind !== 'final' && !R.release)) {
    // held in the golem's fist; swings with the hand
    const g = golemPose(t).grip.P;
    const blend = smooth((tau - GRAB) / 0.12);
    const chest = spawnChest.clone().lerp(g, blend);
    const ga = golemPose(t - 1 / 60).grip.P, gb = golemPose(t + 1 / 60).grip.P;
    const vel = gb.clone().sub(ga).multiplyScalar(30);
    const sp = Math.min(vel.length() * 0.05, 0.9);
    let q = qUp.clone();
    if (sp > 0.01) {
      const axis = V().crossVectors(AY, vel).normalize();
      q = qAxis(axis, -sp).multiply(qUp);
    }
    flail(1);
    limbs.head = [-0.3, 0];
    return { mode: 'held', chest, quat: q, limbs };
  }

  if (R.release && tau < lastHit) {
    const P = throwPath(R);
    const s = tau - R.release;
    const chest = P.p0.clone().addScaledVector(P.v0, s).add(V(0, -0.5 * P.g * s * s, 0));
    const axis = V().crossVectors(P.v0, AY).normalize();
    const spin = R.kind === 'sky' ? 9 : 14;
    flail(1.2);
    limbs.armL = [-1.6 + Math.sin(t * 25) * 0.8, 1.2]; limbs.armR = [-1.6 + Math.sin(t * 25 + 1) * 0.8, -1.2];
    return { mode: 'flight', chest, quat: qAxis(axis, -s * spin).multiply(qUp), limbs };
  }

  // FINAL round: survives the slam
  const C = finalCrater(R);
  const hit = R.hits[0][0];
  const lieChest = V(C.c.x, C.floor + 0.2, C.c.z + 0.1);
  const qLie = qUp.clone().multiply(qAxis(AX, -Math.PI / 2));
  const standChest = V(C.c.x, C.floor + CHEST, C.c.z + 0.1);
  if (tau < R.standUp) {
    const k = smooth((tau - hit) / 0.22);
    const chest = C.c.clone().lerp(lieChest, k);
    chest.y += Math.sin(clamp01((tau - hit - 0.22) / 0.3) * Math.PI) * 0.25;
    limbs.armL = [-0.3, 1.0]; limbs.armR = [-0.2, -1.1]; limbs.legL = [0.1, 0.2]; limbs.legR = [-0.1, -0.2];
    limbs.head = [0.3 * Math.sin(clamp01((tau - 3.7) / 0.3) * Math.PI), 0];
    return { mode: 'lying', chest, quat: qLie, limbs };
  }
  const jumpT = R.punch - 0.42;
  if (tau < jumpT) {
    const k = smooth((tau - R.standUp) / 0.42);
    const chest = lieChest.clone().lerp(standChest, k);
    const q = qLie.clone().slerp(qUp, k);
    limbs.armL = [lerp(-0.3, 0, k), lerp(1, 0.1, k)]; limbs.armR = [lerp(-0.2, 0, k), lerp(-1.1, -0.1, k)];
    // looks up at the golem, then fists up
    limbs.head = [-0.6 * smooth((tau - R.standUp - 0.4) / 0.3), 0];
    if (tau > R.standUp + 0.6) { limbs.armL = [-1.4, 0.3]; limbs.armR = [-1.2, -0.3]; }
    return { mode: 'stand', chest, quat: q, limbs };
  }
  const head = golemPose(R.start + R.punch).head;
  const punchChest = head.clone().add(V(0.0, -0.45, 0.85));
  if (tau < R.punch + 0.05) {
    const k = clamp01((tau - jumpT) / (R.punch - jumpT));
    const chest = standChest.clone().lerp(punchChest, k);
    chest.y += Math.sin(k * Math.PI) * 0.9;
    const q = qAxis(AY, lerp(yaw, Math.PI, smooth(k * 1.5)));
    limbs.armR = [-Math.PI / 2 - 0.1, 0]; limbs.armL = [-0.4, 0.4]; limbs.legL = [-0.6, 0]; limbs.legR = [0.5, 0];
    if (k < 0.6) limbs.armR = [-1.0, -0.2];
    return { mode: 'jump', chest, quat: q, limbs };
  }
  // falls back down and celebrates
  const k = clamp01((tau - R.punch - 0.05) / 0.55);
  const landChest = V(C.c.x, C.floor + CHEST, C.c.z + 0.1);
  const chest = punchChest.clone().lerp(landChest, k);
  chest.y += Math.sin(k * Math.PI) * 0.4;
  const after = tau - R.punch - 0.6;
  if (after > 0) chest.y += Math.abs(Math.sin(after * 7)) * 0.35 * Math.max(0, 1 - after / 2.5);
  const q = qAxis(AY, lerp(Math.PI, yaw, smooth((tau - R.punch) / 0.6)));
  limbs.armL = [-2.8 + Math.sin(t * 14) * 0.2, 0.3]; limbs.armR = [-2.8 - Math.sin(t * 14) * 0.2, -0.3];
  return { mode: 'victory', chest, quat: q, limbs };
}

function heroChest(ri, t) {
  const s = heroState(ri, t);
  return s.chest ? s.chest.clone() : V();
}

// world transforms of the 6 hero parts from a state
function heroPartTransforms(st) {
  const root = st.chest.clone().sub(V(0, CHEST, 0).applyQuaternion(st.quat));
  const out = {};
  for (const [name, P] of Object.entries(HERO_PARTS)) {
    const at = V(P.at[0] * HVS, P.at[1] * HVS, P.at[2] * HVS).applyQuaternion(st.quat).add(root);
    let lq = Q();
    const L = name === 'head' ? st.limbs.head : st.limbs[name];
    if (L) lq = name === 'head' ? qAxis(AY, L[1]).multiply(qAxis(AX, L[0])) : qAxis(AZ, L[1]).multiply(qAxis(AX, L[0]));
    out[name] = { pos: at, quat: st.quat.clone().multiply(lq) };
  }
  return out;
}

// ------------------------------------------------------------------ impacts (pure)
const craterRadius = (str) => 0.8 + 0.85 * str;
let IMPACTS = [];
function buildImpacts() {
  IMPACTS = [];
  ROUNDS.forEach((R, ri) => {
    R.hits.forEach(([ht, left, str], hi) => {
      const t = R.start + ht;
      const c = R.kind === 'stomp' ? V(R.stompAt[0], CHEST, R.stompAt[2]) : heroChest(ri, t - 1e-4);
      const lethal = R.kind !== 'final' && hi === R.hits.length - 1;
      const kind = R.kind === 'wall' ? 'wall' : R.kind === 'ravine' ? 'stone' : 'ground';
      IMPACTS.push({ t, ri, c, str, lethal, kind, dir: R.kind === 'wall' ? V(-1, 0.1, 0) : V(0, -1, 0) });
    });
    // landing puffs
    IMPACTS.push({ t: R.start + LAND, ri, c: V(R.spawn[0], 0.1, R.spawn[2]), str: 0.25, puffOnly: true, kind: 'ground' });
  });
  const F = ROUNDS[6];
  IMPACTS.push({ t: F.start + F.punch, ri: 6, c: golemPose(F.start + F.punch).head.clone(), str: 1.4, shatter: true, kind: 'golem' });
}

// ------------------------------------------------------------------ physics: debris particles + rigid hero parts
const PMAX = 16000;
const P = {
  n: 0, head: 0,
  pos: new Float32Array(PMAX * 3), vel: new Float32Array(PMAX * 3), rot: new Float32Array(PMAX * 3), spin: new Float32Array(PMAX * 3),
  size: new Float32Array(PMAX), col: new Uint32Array(PMAX), flags: new Uint8Array(PMAX), // 1 alive, 2 resting, 4 blood
  born: new Float32Array(PMAX), life: new Float32Array(PMAX),
};
let bodies = [];
let simT = 0, simEvents = [], evIdx = 0;
const DT = 1 / 120, GRAV = 24;

function spawnParticle(x, y, z, vx, vy, vz, size, col, blood = false, rnd = Math.random) {
  const i = P.head;
  P.head = (P.head + 1) % PMAX;
  P.n = Math.min(PMAX, P.n + 1);
  P.pos.set([x, y, z], i * 3);
  P.vel.set([vx, vy, vz], i * 3);
  P.rot.set([rnd() * 6, rnd() * 6, rnd() * 6], i * 3);
  P.spin.set([(rnd() - 0.5) * 20, (rnd() - 0.5) * 20, (rnd() - 0.5) * 20], i * 3);
  P.size[i] = size;
  P.col[i] = col;
  P.flags[i] = 1 | (blood ? 4 : 0);
  // debris clears away after a few seconds so the arena stays readable (craters and stains stay)
  P.born[i] = simT;
  P.life[i] = lifeScale * (2.4 + rnd() * 2.2);
}
let lifeScale = 1;

function wakeAll() {
  for (let i = 0; i < P.n; i++) P.flags[i] &= ~2;
  for (const b of bodies) b.rest = false;
}

function carve(center, r, str, dir, seed, opts = {}) {
  const rnd = rng(seed);
  const g = grid, vs = g.vs;
  const x0 = g.vx(center.x - r - 0.5), x1 = g.vx(center.x + r + 0.5);
  const y0 = g.vy(center.y - r - 0.5), y1 = g.vy(center.y + r + 0.5);
  const z0 = g.vz(center.z - r - 0.5), z1 = g.vz(center.z + r + 0.5);
  let spawned = 0;
  const budget = opts.budget ?? 900;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const c = g.get(x, y, z);
    if (!c) continue;
    const [wx, wy, wz] = g.center(x, y, z);
    const dx = wx - center.x, dy = wy - center.y, dz = wz - center.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const edge = r * (0.82 + 0.36 * hash3(x, y, z, seed));
    if (d < edge) {
      g.set(x, y, z, 0);
      world.markVoxel(x, y, z);
      // most voxels are pulverised; a share fly as debris
      if (spawned < budget && rnd() < (opts.keep ?? 0.3)) {
        const n = V(dx, dy, dz).normalize();
        const sp = (2.5 + rnd() * 6) * (0.6 + str * 0.6);
        const up = 2 + rnd() * 6 * str;
        spawnParticle(wx, wy, wz, n.x * sp + dir.x * 3 * rnd(), Math.abs(n.y) * sp * 0.5 + up, n.z * sp + dir.z * 3 * rnd(), vs * (0.7 + rnd() * 0.5), c, false, rnd);
        spawned++;
      }
    } else if (d < edge + 0.45) {
      // scorched / cracked rim
      g.set(x, y, z, shade(c, 0.82 + 0.1 * hash3(x, y, z, seed + 1)));
      world.markVoxel(x, y, z);
    }
  }
  wakeAll();
}

function stain(center, radius, seed, amount = 70) {
  const rnd = rng(seed);
  const g = grid;
  for (let i = 0; i < amount; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.7) * radius;
    const x = g.vx(center.x + Math.cos(a) * rr), z = g.vz(center.z + Math.sin(a) * rr);
    // first solid voxel downward from just above the impact
    for (let y = g.vy(center.y + 1.2); y > g.vy(center.y - 3); y--) {
      const c = g.get(x, y, z);
      if (c) {
        const k = 0.7 + rnd() * 0.5;
        g.set(x, y, z, rgb(150 * k, 18 * k, 22 * k));
        world.markVoxel(x, y, z);
        break;
      }
    }
  }
}

const BLOOD = (rnd) => rgb(140 + rnd() * 60, 10, 16);

function killHero(ri, t, imp) {
  const st = heroState(ri, t - 1e-4);
  const tr = heroPartTransforms(st);
  const rnd = rng(1000 + ri);
  for (const [name, X] of Object.entries(tr)) {
    const M = heroes[ri].models[name];
    const center = V(...M.body.center).applyQuaternion(X.quat).add(X.pos);
    const out = center.clone().sub(imp.c).setY(0).normalize();
    if (!isFinite(out.x)) out.set(rnd() - 0.5, 0, rnd() - 0.5).normalize();
    const sp = 2.5 + rnd() * 3.5 + imp.str * 1.5;
    const vel = out.multiplyScalar(sp).add(V(0, 3 + rnd() * 4, 0)).add(imp.dir.clone().multiplyScalar(-2));
    if (imp.kind === 'wall') vel.add(V(2.5, 0, 0));
    bodies.push({
      ri, name, pos: center, vel, quat: X.quat.clone(), spin: V(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(14),
      half: M.body.size.map((s) => s / 2), center: V(...M.body.center), rest: false,
    });
    // armour plates crack off as shards
    if (M.armor) {
      const vox = M.armor.vox;
      for (let k = 0; k < 18; k++) {
        const v = vox[Math.floor(rnd() * vox.length)];
        const p = V(v[0], v[1], v[2]).applyQuaternion(X.quat).add(X.pos);
        const d = p.clone().sub(imp.c).normalize();
        spawnParticle(p.x, p.y, p.z, d.x * 5 + (rnd() - 0.5) * 4, 3 + rnd() * 6, d.z * 5 + (rnd() - 0.5) * 4, HVS * (1 + rnd()), v[3], false, rnd);
      }
    }
  }
  // blood burst
  for (let k = 0; k < 90; k++) {
    const a = rnd() * Math.PI * 2, e = rnd() * 1.2;
    const sp = 2 + rnd() * 7;
    spawnParticle(imp.c.x + (rnd() - 0.5) * 0.4, imp.c.y + rnd() * 0.3, imp.c.z + (rnd() - 0.5) * 0.4,
      Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 2, Math.sin(a) * Math.cos(e) * sp, HVS * (0.8 + rnd() * 1.4), BLOOD(rnd), true, rnd);
  }
  const ground = imp.kind === 'wall' ? V(imp.c.x + 0.6, 0.3, imp.c.z) : imp.c;
  stain(ground, 0.6 + imp.str * 0.4, 77 + ri, 28);
  if (imp.kind === 'wall') stain(V(imp.c.x - 0.1, imp.c.y, imp.c.z), 1.2, 88, 0);
}

function shatterGolem(t, imp) {
  const pose = golemPose(t - 1e-4);
  const rnd = rng(4242);
  let total = 0;
  for (const name of Object.keys(GOLEM_PARTS)) total += GM[GOLEM_PARTS[name]].vox.length;
  const keep = Math.min(1, 9000 / total);
  lifeScale = 3;
  for (const [name, model] of Object.entries(GOLEM_PARTS)) {
    const X = pose.parts[name];
    for (const v of GM[model].vox) {
      if (rnd() > keep) continue;
      const p = V(v[0], v[1], v[2]).applyQuaternion(X.quat).add(X.pos);
      const d = p.clone().sub(imp.c);
      const dist = d.length();
      d.normalize();
      const sp = (3 + rnd() * 7) * Math.max(0.35, 1.6 - dist * 0.25);
      spawnParticle(p.x, p.y, p.z, d.x * sp + (rnd() - 0.5) * 2, d.y * sp * 0.6 + 2 + rnd() * 4, d.z * sp + (rnd() - 0.5) * 2 - 1.5, GVS * 0.95, v[3], false, rnd);
    }
  }
}

function resetSim() {
  grid.c.set(pristine);
  world.markAll();
  P.n = 0; P.head = 0; P.flags.fill(0);
  lifeScale = 1;
  bodies = [];
  simT = 0;
  evIdx = 0;
}

function buildSimEvents() {
  simEvents = [];
  for (const imp of IMPACTS) {
    if (imp.puffOnly) continue;
    simEvents.push(imp);
  }
  simEvents.sort((a, b) => a.t - b.t);
}

function applyEvent(imp, idx) {
  if (imp.shatter) return shatterGolem(imp.t, imp);
  const r = craterRadius(imp.str);
  if (imp.kind === 'wall') {
    const c = imp.c.clone().add(V(-0.45, 0, 0));
    carve(c, 1.35, imp.str, imp.dir, 500 + idx, { keep: 0.5 });
    carve(c.clone().add(V(-0.1, 1.5, 0.3)), 1.15, imp.str * 0.5, V(-0.3, -1, 0), 600 + idx, { keep: 0.55 });
  } else if (imp.kind === 'stone') {
    carve(V(imp.c.x, imp.c.y - 0.35 + 0.1 * r, imp.c.z), r * 0.8, imp.str, imp.dir, 500 + idx, { keep: 0.35 });
  } else {
    carve(V(imp.c.x, imp.c.y - 0.35 + 0.25 * r, imp.c.z), r, imp.str, imp.dir, 500 + idx, { budget: imp.str > 1.2 ? 800 : 700 });
  }
  if (imp.lethal) killHero(imp.ri, imp.t, imp);
}

function stepParticles(dt) {
  const g = grid;
  const pos = P.pos, vel = P.vel, rot = P.rot, spin = P.spin;
  for (let i = 0; i < P.n; i++) {
    const f = P.flags[i];
    if (!(f & 1) || (f & 2)) continue;
    const j = i * 3;
    vel[j + 1] -= GRAV * dt;
    let x = pos[j], y = pos[j + 1], z = pos[j + 2];
    const h = P.size[i] * 0.5;
    let nx = x + vel[j] * dt, ny = y + vel[j + 1] * dt, nz = z + vel[j + 2] * dt;
    let hit = false;
    if (g.solidAt(x, ny - h, z) || g.solidAt(x, ny + h, z)) {
      hit = true;
      if (f & 4) { // blood sticks and stains what it hits (only some drops leave a mark)
        const vx = g.vx(x), vy = g.vy(ny - h), vz = g.vz(z);
        if (g.get(vx, vy, vz) && (i % 3 === 0)) { g.set(vx, vy, vz, P.col[i]); world.markVoxel(vx, vy, vz); }
        P.flags[i] = 0;
        continue;
      }
      ny = y;
      vel[j + 1] = -vel[j + 1] * 0.22;
      vel[j] *= 0.55; vel[j + 2] *= 0.55;
      spin[j] *= 0.5; spin[j + 1] *= 0.5; spin[j + 2] *= 0.5;
    }
    if (g.solidAt(nx, ny, z)) { vel[j] *= -0.3; nx = x; hit = true; }
    if (g.solidAt(nx, ny, nz)) { vel[j + 2] *= -0.3; nz = z; hit = true; }
    pos[j] = nx; pos[j + 1] = ny; pos[j + 2] = nz;
    rot[j] += spin[j] * dt; rot[j + 1] += spin[j + 1] * dt; rot[j + 2] += spin[j + 2] * dt;
    if (hit && vel[j] * vel[j] + vel[j + 1] * vel[j + 1] + vel[j + 2] * vel[j + 2] < 0.6 && g.solidAt(nx, ny - h - 0.05, nz)) P.flags[i] |= 2;
    if (ny < -20) P.flags[i] = 0;
  }
  for (let i = 0; i < P.n; i++) if ((P.flags[i] & 1) && simT - P.born[i] > P.life[i]) P.flags[i] = 0;
}

const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function stepBodies(dt) {
  const g = grid;
  for (const b of bodies) {
    if (b.rest) continue;
    b.vel.y -= GRAV * dt;
    const rad = Math.min(...b.half) * 0.95;
    const n = b.pos.clone().addScaledVector(b.vel, dt);
    let ground = false;
    if (g.solidAt(b.pos.x, n.y - rad, b.pos.z)) {
      ground = true;
      // push out of the floor
      let lift = 0;
      while (g.solidAt(b.pos.x, n.y - rad + lift, b.pos.z) && lift < 1) lift += 0.02;
      n.y += lift;
      b.vel.y = Math.abs(b.vel.y) > 2 ? -b.vel.y * 0.25 : 0;
      b.vel.x *= 0.7; b.vel.z *= 0.7;
      b.spin.multiplyScalar(0.6);
      // settle with the long axis flat
      const longest = b.half.indexOf(Math.max(...b.half));
      const ax = [AX, AY, AZ][longest].clone().applyQuaternion(b.quat);
      const flat = ax.clone().setY(0);
      if (flat.lengthSq() > 1e-4) {
        _q.setFromUnitVectors(ax, flat.normalize());
        b.quat.premultiply(Q().slerp(_q, 0.25));
      }
    }
    if (g.solidAt(n.x, n.y, b.pos.z)) { b.vel.x *= -0.3; n.x = b.pos.x; }
    if (g.solidAt(n.x, n.y, n.z)) { b.vel.z *= -0.3; n.z = b.pos.z; }
    b.pos.copy(n);
    const w = b.spin.length();
    if (w > 1e-3) b.quat.premultiply(qAxis(b.spin.clone().divideScalar(w), w * dt));
    if (ground && b.vel.lengthSq() < 0.3 && b.spin.lengthSq() < 0.5) b.rest = true;
    if (b.pos.y < -20) b.rest = true;
  }
}

function advance(t) {
  if (t < simT - 1e-6) resetSim();
  while (simT < t - 1e-9) {
    while (evIdx < simEvents.length && simEvents[evIdx].t <= simT + DT) {
      applyEvent(simEvents[evIdx], evIdx);
      evIdx++;
    }
    stepParticles(DT);
    stepBodies(DT);
    simT += DT;
  }
}

// ------------------------------------------------------------------ dust (pure function of t)
function dustAt(t) {
  const out = [];
  for (const imp of IMPACTS) {
    const age = t - imp.t;
    const life = 1.6 + imp.str;
    if (age < 0 || age > life) continue;
    const n = imp.puffOnly ? 8 : imp.shatter ? 40 : Math.round(16 + imp.str * 18);
    const rnd = rng(Math.round(imp.t * 1000));
    const base = imp.kind === 'stone' ? [0.62, 0.6, 0.58] : imp.kind === 'golem' ? [0.6, 0.66, 0.55] : imp.kind === 'wall' ? [0.66, 0.66, 0.66] : [0.66, 0.56, 0.44];
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2, spd = (0.6 + rnd() * 1.6) * (0.6 + imp.str);
      const dx = Math.cos(a), dz = Math.sin(a);
      const e = 1 - Math.exp(-age * 3.2);
      const p = imp.c.clone().add(V(dx * spd * e * 1.2, (imp.kind === 'golem' ? (rnd() - 0.4) * 2 * e : 0) + age * (0.35 + rnd() * 0.5) + 0.1, dz * spd * e * 1.2));
      if (imp.kind === 'wall') p.x += -e * 1.2 * rnd();
      const sz = (0.5 + rnd() * 0.6) * (0.5 + imp.str * 0.7) * (1 + e * 1.8);
      const al = 0.5 * Math.pow(1 - age / life, 1.6) * clamp01(age / 0.05);
      const sh = 0.85 + rnd() * 0.25;
      out.push([p.x, p.y, p.z, sz, al, base[0] * sh, base[1] * sh, base[2] * sh]);
    }
  }
  return out;
}

// ------------------------------------------------------------------ camera
function cameraAt(t) {
  let keys, tau;
  const r = roundAt(t);
  if (r < 0) { keys = HOOK_CAMERA; tau = t; } else { keys = CAM_KEYS[r]; tau = t - ROUNDS[r].start; }
  const pos = track(keys.map((k) => [k[0], k[1]]), tau);
  const look = track(keys.map((k) => [k[0], k[2]]), tau);
  const fov = track(keys.map((k) => [k[0], k[3]]), tau);
  // impact shake
  let sx = 0, sy = 0;
  for (const imp of IMPACTS) {
    const age = t - imp.t;
    if (age < 0 || age > 0.8) continue;
    const a = (imp.puffOnly ? 0.03 : 0.22) * imp.str * Math.exp(-age * 7);
    sx += Math.sin(age * 71 + imp.t) * a;
    sy += Math.cos(age * 57 + imp.t * 3) * a;
  }
  return { pos: V(...pos), look: V(...look).add(V(sx, sy, 0)), fov, shake: Math.hypot(sx, sy) };
}
const CAM_KEYS = ROUNDS.map((R, i) => cameraKeys(R, i));

// ------------------------------------------------------------------ scene
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `
      varying vec3 vDir; uniform float time;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
      vec3 lin(vec3 c){ return pow(c, vec3(2.2)); }
      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 top = lin(vec3(0.26,0.52,0.90)), hor = lin(vec3(0.84,0.90,0.97));
        vec3 c = mix(hor, top, smoothstep(0.0, 0.6, h));
        if (h < 0.0) c = mix(hor, lin(vec3(0.78,0.85,0.93)), smoothstep(0.0, -0.4, -h) * 0.0 + smoothstep(0.0,-0.5,h));
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.1 + vec2(time * 0.012, 0.0);
          float n = fbm(uv * 1.3);
          float cl = smoothstep(0.48, 0.72, n) * smoothstep(0.0, 0.18, h);
          vec3 cc = lin(vec3(1.0)) * (0.82 + 0.25 * smoothstep(0.5, 0.85, fbm(uv * 1.3 + vec2(0.06, 0.09))));
          c = mix(c, cc, cl * 0.92);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

let skyMesh, voxMat;
function buildScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.84, 0.9, 0.97, THREE.SRGBColorSpace), 40, 140);
  skyMesh = buildSky();
  const hemi = new THREE.HemisphereLight(new THREE.Color().setRGB(0.75, 0.85, 1.0, THREE.SRGBColorSpace), new THREE.Color().setRGB(0.55, 0.62, 0.42, THREE.SRGBColorSpace), 1.25);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1.0, 0.96, 0.88, THREE.SRGBColorSpace), 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  voxMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  grid = buildTerrain();
  pristine = grid.c.slice();
  const terrain = new THREE.Group();
  scene.add(terrain);
  world = new ChunkedWorld(grid, voxMat, terrain, 32);
  world.flush();

  // golem
  GM = buildGolemModels();
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 2.6) });
  for (const [name, model] of Object.entries(GOLEM_PARTS)) {
    const m = new THREE.Mesh(GM[model].geo, model === 'eyes' ? eyeMat : voxMat);
    m.castShadow = model !== 'eyes';
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    scene.add(m);
    golemMeshes[name] = m;
  }
  // heroes, one per armour tier
  ROUNDS.forEach((R, ri) => {
    const models = buildHeroModels(TIERS[R.tier]);
    const meshes = {};
    for (const [name, M] of Object.entries(models)) {
      const m = new THREE.Mesh(M.body.geo, voxMat);
      m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false;
      if (M.armor) {
        const a = new THREE.Mesh(M.armor.geo, voxMat);
        a.castShadow = true; a.receiveShadow = true;
        m.add(a);
      }
      m.visible = false;
      scene.add(m);
      meshes[name] = m;
    }
    heroes.push({ models, meshes });
  });
  // particles
  const box = new THREE.BoxGeometry(1, 1, 1);
  parts = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), PMAX);
  parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parts.castShadow = true;
  parts.receiveShadow = true;
  parts.frustumCulled = false;
  parts.setColorAt(0, new THREE.Color());
  scene.add(parts);
  // dust
  const DMAX = 400;
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DMAX * 3), 3));
  dg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(DMAX), 1));
  dg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(DMAX), 1));
  dg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(DMAX * 3), 3));
  const dm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { scale: { value: 1 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(900.0, size * scale / -mv.z); vA = alpha; vC = color; }`,
    fragmentShader: `varying float vA; varying vec3 vC;
      void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.1, d) * vA; gl_FragColor = vec4(pow(vC, vec3(2.2)), a); }`,
  });
  dust = new THREE.Points(dg, dm);
  dust.frustumCulled = false;
  dust.renderOrder = 5;
  scene.add(dust);
}

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _c = new THREE.Color();
function setMat(mesh, pos, quat) {
  mesh.matrix.compose(pos, quat, _s);
  mesh.matrixWorldNeedsUpdate = true;
}

function updateGolem(t) {
  const F = ROUNDS[6];
  const gone = t >= F.start + F.punch;
  const pose = golemPose(t);
  for (const [name, m] of Object.entries(golemMeshes)) {
    m.visible = !gone;
    if (gone) continue;
    const X = pose.parts[name];
    setMat(m, X.pos, X.quat);
  }
  // eyes flare on roars
  return pose;
}

function updateHeroes(t) {
  ROUNDS.forEach((R, ri) => {
    const H = heroes[ri];
    if (t < R.start) { for (const m of Object.values(H.meshes)) m.visible = false; return; }
    const st = heroState(ri, t);
    if (st.mode === 'dead') {
      const bs = bodies.filter((b) => b.ri === ri);
      for (const m of Object.values(H.meshes)) m.visible = false;
      for (const b of bs) {
        const m = H.meshes[b.name];
        m.visible = true;
        const p = b.pos.clone().sub(b.center.clone().applyQuaternion(b.quat));
        setMat(m, p, b.quat);
      }
      return;
    }
    const tr = heroPartTransforms(st);
    for (const [name, m] of Object.entries(H.meshes)) {
      m.visible = true;
      setMat(m, tr[name].pos, tr[name].quat);
    }
  });
}

function updateParticles() {
  let n = 0;
  for (let i = 0; i < P.n; i++) {
    if (!(P.flags[i] & 1)) continue;
    const j = i * 3;
    _e.set(P.rot[j], P.rot[j + 1], P.rot[j + 2]);
    _q.setFromEuler(_e);
    const age = simT - P.born[i];
    const s = P.size[i] * clamp01((P.life[i] - age) / 0.6);
    if (s <= 0.001) continue;
    _v.set(P.pos[j], P.pos[j + 1], P.pos[j + 2]);
    _m.compose(_v, _q, new THREE.Vector3(s, s, s));
    parts.setMatrixAt(n, _m);
    const c = P.col[i];
    _c.setRGB(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, THREE.SRGBColorSpace);
    parts.setColorAt(n, _c);
    n++;
  }
  parts.count = n;
  parts.instanceMatrix.needsUpdate = true;
  if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
}

function updateDust(t) {
  const list = dustAt(t);
  const g = dust.geometry;
  const pos = g.attributes.position.array, size = g.attributes.size.array, alpha = g.attributes.alpha.array, col = g.attributes.color.array;
  const n = Math.min(list.length, size.length);
  for (let i = 0; i < n; i++) {
    const d = list[i];
    pos[i * 3] = d[0]; pos[i * 3 + 1] = d[1]; pos[i * 3 + 2] = d[2];
    size[i] = d[3]; alpha[i] = d[4];
    col[i * 3] = d[5]; col[i * 3 + 1] = d[6]; col[i * 3 + 2] = d[7];
  }
  g.setDrawRange(0, n);
  for (const k of ['position', 'size', 'alpha', 'color']) g.attributes[k].needsUpdate = true;
  dust.material.uniforms.scale.value = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

// ------------------------------------------------------------------ API
async function loadFonts() {
  const list = [
    ['Pixelify', 'pixelify-sans/files/pixelify-sans-latin-700-normal.woff2', '700'],
    ['Luckiest', 'luckiest-guy/files/luckiest-guy-latin-400-normal.woff2', '400'],
    ['PressStart', 'press-start-2p/files/press-start-2p-latin-400-normal.woff2', '400'],
  ];
  for (const [family, file, weight] of list) {
    const f = new FontFace(family, `url(/node_modules/@fontsource/${file})`, { weight });
    await f.load();
    document.fonts.add(f);
  }
  try { await document.fonts.load('100px "Noto Color Emoji"', '👇'); } catch { /* optional */ }
}

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
  renderer.toneMappingExposure = 1.05;
  document.body.appendChild(renderer.domElement);
  camera = new THREE.PerspectiveCamera(56, W / H, 0.05, 1200);
  buildScene();
  buildImpacts();
  buildSimEvents();

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W / 2, H / 2), 0.32, 0.4, 0.96));
  composer.addPass(new OutputPass());
  if (opts.aa !== false) composer.addPass(new SMAAPass());
  fxPass = new ShaderPass(FxShader);
  fxPass.uniforms.res.value = [W, H];
  fxPass.uniforms.vignette.value = 0.3;
  fxPass.uniforms.grain.value = 0.02;
  composer.addPass(fxPass);

  hud = new Hud();
  out2d = document.createElement('canvas');
  out2d.width = W;
  out2d.height = H;
  ctx2d = out2d.getContext('2d');
  return { voxels: grid.c.length, impacts: IMPACTS.length };
};

window.renderFrame = (t) => {
  advance(t);
  world.flush();
  updateGolem(t);
  updateHeroes(t);
  updateParticles();

  const cam = cameraAt(t);
  camera.position.copy(cam.pos);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
  camera.lookAt(cam.look);
  camera.updateMatrixWorld();
  updateDust(t);
  skyMesh.position.copy(camera.position);
  skyMesh.material.uniforms.time.value = t;

  // shadow frustum follows what the camera looks at
  const focus = cam.look.clone();
  focus.y = Math.max(-11, Math.min(focus.y, 3));
  sun.target.position.copy(focus);
  sun.position.copy(focus).add(V(16, 30, 14));
  const sc = sun.shadow.camera;
  sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 90;
  sc.updateProjectionMatrix();

  // flashes on lethal hits and on the final punch
  let flash = 0, rgbAmt = 0;
  for (const imp of IMPACTS) {
    const age = t - imp.t;
    if (imp.puffOnly || age < 0 || age > 0.3) continue;
    flash = Math.max(flash, (imp.shatter ? 0.55 : 0.22 * imp.str) * Math.exp(-age * 14));
    rgbAmt = Math.max(rgbAmt, 6 * imp.str * Math.exp(-age * 9));
  }
  const u = fxPass.uniforms;
  u.time.value = t;
  u.flash.value = flash;
  u.rgb.value = rgbAmt;
  u.fade.value = 0;
  u.blur.value = 0;
  u.glitch.value = 0;
  u.scan.value = 0;
  u.warm.value = 0;
  composer.render();

  ctx2d.setTransform(1, 0, 0, 1, 0, 0);
  ctx2d.drawImage(renderer.domElement, 0, 0);
  ctx2d.setTransform(W / REF_W, 0, 0, H / REF_H, 0, 0);
  hud.draw(ctx2d, t, { W: REF_W, H: REF_H });
  return { round: roundAt(t), particles: parts.count, bodies: bodies.length };
};

window.debugInfo = (t) => {
  const g = golemPose(t);
  const r = roundAt(t);
  const st = r >= 0 ? heroState(r, t) : null;
  return { grip: g.grip.P.toArray().map((v) => +v.toFixed(2)), head: g.head.toArray().map((v) => +v.toFixed(2)), hero: st && st.chest ? st.chest.toArray().map((v) => +v.toFixed(2)) : st && st.mode, impacts: IMPACTS.map((i) => [i.t, i.c.toArray().map((v) => +v.toFixed(2))]) };
};

window.grabFrame = (type = 'image/png', q) => out2d.toDataURL(type, q);
window.ready = true;
