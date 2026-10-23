// Camera direction: a list of shots, each a set of keyframes eased between.
import { NOOB, PRO, HACK } from './world.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const polar = (c, deg, r, h) => [c[0] + r * Math.sin((deg * Math.PI) / 180), h, c[2] + r * Math.cos((deg * Math.PI) / 180)];

const N = [NOOB.x + 0.5, 1.5, NOOB.z + 0.5];
const P = [PRO.x + 0.5, 4, PRO.z + 0.5];
const H = [HACK.x, 7, HACK.z];

// end screen: all three builds on a diagonal, then up to the moon
const AERIAL = { pos: [-20, 35, 80], drift: [-19, 34.2, 77.5], look: [1, 3, 6], fov: 42 };
// Unit vector towards the moon. It sits high (out of every shot) until the end
// screen, where it drops to where the final tilt finds it.
const dirFrom = (azDeg, elDeg) => {
  const az = (azDeg * Math.PI) / 180, el = (elDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
};
export const MOON_HIGH = dirFrom(16, 58);
export const MOON_DIR = dirFrom(16, 24);
// look slightly below the moon so it sits in the upper third of the frame
const moonLook = (p) => [p[0] + MOON_DIR[0] * 100, p[1] + MOON_DIR[1] * 100 - 10, p[2] + MOON_DIR[2] * 100];

export function makeShots(T) {
  const S = T.sections, E = T.events;
  const orbit = (c, d0, d1, r0, r1, h0, h1, look0, look1) => (u) => ({
    pos: polar(c, lerp(d0, d1, u), lerp(r0, r1, u), lerp(h0, h1, u)),
    look: lerp3(look0, look1, u),
  });
  return [
    {
      // cold open on the finished pumpkin, pushing in
      t0: S.hook[0], t1: S.hook[1], easing: easeOut,
      path: orbit(H, 9, 3, 41, 33, 3.2, 4.2, [H[0], 7.6, H[2]], [H[0], 7.8, H[2]]), fov: [58, 56],
    },
    {
      // rewind: pull back fast while the pumpkin un-builds
      t0: S.rewind[0], t1: S.rewind[1], easing: ease,
      path: orbit(H, 3, -14, 33, 44, 4.2, 8, [H[0], 7.8, H[2]], [H[0], 5, H[2]]), fov: [56, 62],
    },
    {
      t0: S.noob[0], t1: E.noobPunch, easing: (u) => u,
      path: orbit(N, 30, 52, 12, 10.6, 5.6, 6.4, [N[0], N[1] + 0.8, N[2]], [N[0] + 0.4, N[1] + 1.4, N[2]]), fov: [54, 52],
    },
    {
      // crash zoom on the uncarved pumpkin
      t0: E.noobPunch, t1: S.noob[1], easing: (u) => easeOut(Math.min(1, u * 4.5)),
      path: (u) => ({
        pos: lerp3(polar(N, 52, 10.6, 6.4), polar(N, 55, 8, 6.2), u),
        look: lerp3([N[0] + 0.4, N[1] + 1.4, N[2]], [NOOB.x + 1.5, 4.4, NOOB.z + 0.5], u),
      }),
      fov: [52, 33],
    },
    {
      t0: S.pro[0], t1: E.proLights, easing: (u) => ease(u) * 0.85 + u * 0.15,
      path: orbit([P[0] + 2.5, 0, P[2]], 58, 24, 26, 25, 6.5, 10.5, [P[0] + 3.5, 3.6, P[2]], [P[0] + 2.5, 4.4, P[2] + 1]), fov: [56, 54],
    },
    {
      // lights on: drift in towards the porch
      t0: E.proLights, t1: S.pro[1], easing: ease,
      path: (u) => ({
        pos: lerp3(polar([P[0] + 2.5, 0, P[2]], 24, 25, 10.5), [P[0] + 5.5, 4.2, P[2] + 19], u),
        look: lerp3([P[0] + 2.5, 4.4, P[2] + 1], [P[0] + 0.5, 3.4, P[2] + 4], u),
      }),
      fov: [54, 50],
    },
    {
      // the empty hacker plot while the command is typed
      t0: S.hacker[0], t1: E.lightning[1], easing: (u) => u,
      path: orbit(H, -6, -2, 26, 24.5, 2.4, 2.6, [H[0], 6.5, H[2]], [H[0], 6.8, H[2]]), fov: [62, 60],
    },
    {
      // the build: rise and orbit with it
      t0: E.lightning[1], t1: E.faceOn, easing: (u) => ease(u) * 0.7 + u * 0.3,
      path: orbit(H, -30, 22, 27, 25, 2.5, 6.5, [H[0], 4, H[2]], [H[0], 8, H[2]]), fov: [68, 66],
    },
    {
      // hero angle on the lit face
      t0: E.faceOn, t1: S.hacker[1], easing: (u) => u,
      path: (u) => ({
        pos: lerp3([H[0] - 8, 1.5, H[2] + 25.5], [H[0] + 6, 2.0, H[2] + 26.5], u),
        look: lerp3([H[0] - 0.5, 8.6, H[2]], [H[0] + 0.5, 8.8, H[2]], u),
      }),
      fov: [64, 62],
    },
    {
      // crane up and back to reveal all three builds
      t0: E.crane[0], t1: E.crane[1], easing: ease,
      path: (u) => ({
        pos: [lerp(H[0] + 6, AERIAL.pos[0], u), lerp(2.0, AERIAL.pos[1], ease(Math.min(1, u * 1.2))), lerp(H[2] + 26.5, AERIAL.pos[2], u)],
        look: lerp3([H[0] + 0.5, 8.8, H[2]], AERIAL.look, u),
      }),
      fov: [64, AERIAL.fov],
    },
    {
      t0: E.crane[1], t1: E.tilt[0], easing: (u) => u,
      path: (u) => ({ pos: lerp3(AERIAL.pos, AERIAL.drift, u), look: AERIAL.look }),
      fov: [AERIAL.fov, AERIAL.fov - 1],
    },
    {
      // whip tilt up to the moon
      t0: E.tilt[0], t1: E.tilt[1], easing: ease,
      path: (u) => ({ pos: AERIAL.drift, look: lerp3(AERIAL.look, moonLook(AERIAL.drift), u) }),
      fov: [AERIAL.fov - 1, 27],
    },
    {
      t0: E.tilt[1], t1: T.duration, easing: (u) => u,
      path: () => ({ pos: AERIAL.drift, look: moonLook(AERIAL.drift) }),
      fov: [27, 23],
    },
  ];
}

export function cameraAt(shots, t) {
  let s = shots.find((x) => t >= x.t0 && t < x.t1) || shots[shots.length - 1];
  const u = Math.max(0, Math.min(1, (t - s.t0) / (s.t1 - s.t0)));
  const e = s.easing(u);
  const { pos, look } = s.path(e);
  return { pos, look, fov: lerp(s.fov[0], s.fov[1], e), shot: shots.indexOf(s) };
}
