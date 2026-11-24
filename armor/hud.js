// 2D overlay: the armour-tier row with red X stamps, the hearts bar, round labels and titles.
// Pixel art (chestplates, hearts) is drawn from small masks in code.
import { ROUNDS, TIERS, HOOK, heartsAt, roundAt } from './plan.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const hex = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;

const CHEST = [
  '..XXX....XXX..',
  '.XXXXX..XXXXX.',
  'XXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXX',
  '.XXXXXXXXXXXX.',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
  '...XXXXXXXX...',
];
const HEART = [
  '.XX...XX.',
  'XXXX.XXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....',
];

function maskAt(m, x, y) { return y >= 0 && y < m.length && x >= 0 && x < m[0].length && m[y][x] === 'X'; }

// draw a mask with a 1px dark outline; colour(x, y) returns a css colour per pixel
function drawMask(ctx, m, ox, oy, px, colour) {
  const w = m[0].length, h = m.length;
  ctx.fillStyle = 'rgba(12,10,14,0.95)';
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) {
    if (maskAt(m, x, y)) continue;
    if (maskAt(m, x - 1, y) || maskAt(m, x + 1, y) || maskAt(m, x, y - 1) || maskAt(m, x, y + 1)) ctx.fillRect(ox + x * px, oy + y * px, px + 0.5, px + 0.5);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!maskAt(m, x, y)) continue;
    ctx.fillStyle = colour(x, y);
    ctx.fillRect(ox + x * px, oy + y * px, px + 0.5, px + 0.5);
  }
}

function chestColour(tier, dim) {
  return (x, y) => {
    const k = dim ? 0.45 : 1;
    if (tier.holes && (x + y) % 2 === 0 && y > 1 && x > 0 && x < 13) return hex(tier.dark, k * 0.7);
    // light on the upper-left, shade on the right and bottom, a centre seam
    if ((x === 1 || x === 2) && y >= 1 && y <= 4) return hex(tier.light, k);
    if (y === 2 && x >= 3 && x <= 10) return hex(tier.light, k);
    if (x >= 11 || y >= 10) return hex(tier.dark, k);
    if (x === 7 && y >= 4) return hex(tier.dark, k);
    if (tier.patina && ((x * 3 + y * 5) % 7 === 0)) return hex(tier.patina, k);
    if (tier.id === 'obsidian' && (x * 7 + y * 3) % 11 === 0) return hex([150, 90, 230], k);
    return hex(tier.base, k);
  };
}

function mcText(ctx, str, x, y, size, color, { font = 'Luckiest', align = 'center', outline = 0.16, shadow = '#000' } = {}) {
  ctx.font = `${font === 'Pixelify' ? 700 : 400} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const off = Math.max(3, Math.round(size * 0.07));
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * outline;
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.strokeText(str, x + off, y + off);
  ctx.fillStyle = shadow;
  ctx.fillText(str, x + off, y + off);
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export class Hud {
  draw(ctx, t, { W, H }) {
    this.tiers(ctx, t, W);
    this.hearts(ctx, t, W);
    this.label(ctx, t, W);
    this.title(ctx, t, W);
    this.ending(ctx, t, W, H);
  }

  tiers(ctx, t, W) {
    const px = 7, iw = 14 * px, gap = 18;
    const total = TIERS.length * iw + (TIERS.length - 1) * gap;
    const x0 = (W - total) / 2, y0 = 190;
    const cur = roundAt(t);
    const intro = clamp01((t - 0.0) / 0.5);
    TIERS.forEach((tier, i) => {
      const R = ROUNDS[i];
      const failed = R.kind !== 'final' && t >= R.start + R.xAt;
      const active = i === cur;
      const pop = easeOutBack(clamp01((intro * 7 - i) / 1.5 + 0.0));
      let sc = pop;
      let dy = 0;
      if (active) {
        const a = easeOutBack(clamp01((t - R.start) / 0.3));
        sc *= 1 + 0.22 * a;
        dy = -8 * a + Math.sin(t * 6) * 3 * a;
      }
      const cx = x0 + i * (iw + gap) + iw / 2, cy = y0 + 6 * px + dy;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(sc, sc);
      if (active) {
        // glow plate behind the current tier
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(-iw / 2 - 10, -6 * px - 12, iw + 20, 12 * px + 24);
      }
      drawMask(ctx, CHEST, -iw / 2, -6 * px, px, chestColour(tier, failed));
      if (failed) {
        const k = clamp01((t - (R.start + R.xAt)) / 0.18);
        const s = 1 + (1 - easeOutBack(k)) * 1.4;
        ctx.save();
        ctx.scale(s, s);
        ctx.globalAlpha = clamp01(k * 3);
        ctx.lineCap = 'square';
        for (const [w, col] of [[30, '#1a0000'], [18, '#ff2020']]) {
          ctx.strokeStyle = col;
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(-40, -36); ctx.lineTo(40, 36);
          ctx.moveTo(40, -36); ctx.lineTo(-40, 36);
          ctx.stroke();
        }
        ctx.restore();
      }
      // survived badge
      if (R.kind === 'final' && t >= R.start + R.survive) {
        const k = easeOutBack(clamp01((t - R.start - R.survive) / 0.3));
        ctx.save();
        ctx.scale(k, k);
        ctx.strokeStyle = '#062400'; ctx.lineWidth = 30; ctx.lineCap = 'square';
        ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(-10, 26); ctx.lineTo(38, -30); ctx.stroke();
        ctx.strokeStyle = '#4dff3a'; ctx.lineWidth = 17;
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    });
  }

  hearts(ctx, t, W) {
    const px = 6, hw = 9 * px, gap = 8;
    const total = 10 * hw + 9 * gap;
    const x0 = (W - total) / 2, y0 = 320;
    const hp = heartsAt(t);
    const r = roundAt(t);
    // recent damage: shake the row, flash the lost hearts
    let shake = 0, flashFrom = 99, flashTo = -1;
    if (r >= 0) {
      const R = ROUNDS[r];
      const hits = R.hits.map((h) => h[0]).concat(R.drain2 ? [R.drain2[0]] : []);
      for (const ht of hits) {
        const age = t - R.start - ht;
        if (age >= 0 && age < 0.45) {
          shake = Math.max(shake, (1 - age / 0.45) * 12);
          flashFrom = Math.min(flashFrom, Math.floor(hp));
          flashTo = 10;
        }
      }
    }
    const low = hp <= 2 && hp > 0;
    const intro = clamp01((t - 0.15) / 0.5);
    for (let i = 0; i < 10; i++) {
      const pop = easeOutBack(clamp01(intro * 10 - i * 0.6));
      if (pop <= 0) continue;
      let dx = Math.sin(t * 90 + i) * shake * 0.5, dy = Math.cos(t * 77 + i * 2) * shake * 0.5;
      if (low) dy += Math.sin(t * 40 + i * 1.7) > 0.3 ? -5 : 0;
      const ox = x0 + i * (hw + gap) + dx, oy = y0 + dy;
      ctx.save();
      ctx.translate(ox + hw / 2, oy + 4 * px);
      ctx.scale(pop, pop);
      const fill = hp >= i + 1 ? 1 : hp >= i + 0.5 ? 0.5 : 0;
      const flashing = i >= flashFrom && i < flashTo && Math.floor(t * 20) % 2 === 0;
      drawMask(ctx, HEART, -hw / 2, -4 * px, px, (x, y) => {
        if (flashing && fill === 0) return '#ffffff';
        const filled = fill === 1 || (fill === 0.5 && x <= 4);
        if (!filled) return y < 2 ? '#3a2a2a' : '#2a1c1c';
        if ((x === 1 || x === 2) && y === 1) return '#ffd0d0';
        if (y >= 5 || x >= 7) return '#a8100e';
        return '#e8241e';
      });
      ctx.restore();
    }
  }

  label(ctx, t, W) {
    const r = roundAt(t);
    if (r < 0) return;
    const R = ROUNDS[r], tier = TIERS[R.tier];
    const tau = t - R.start;
    const end = R.kind === 'final' ? R.survive - 0.1 : R.xAt + 0.35;
    if (tau > end + 0.2) return;
    const k = easeOutBack(clamp01(tau / 0.28));
    const out = clamp01((tau - end) / 0.2);
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.translate(W / 2, 455);
    ctx.rotate(Math.sin(tau * 3) * 0.02);
    ctx.scale(k, k);
    mcText(ctx, `${tier.name} ARMOR`, 0, 0, 76, hex(tier.label || tier.light), { shadow: hex(tier.dark, 0.6) });
    ctx.restore();
  }

  title(ctx, t, W) {
    const [a, b] = HOOK;
    if (t >= b) return;
    const out = clamp01((t - (b - 0.18)) / 0.18);
    ctx.save();
    ctx.globalAlpha = 1 - out;
    const k1 = easeOutBack(clamp01((t - 0.05) / 0.3));
    ctx.translate(W / 2, 560);
    ctx.save();
    ctx.scale(k1, k1);
    ctx.rotate(-0.03);
    mcText(ctx, 'WHICH ARMOR', 0, 0, 118, '#FFFFFF');
    ctx.restore();
    const k2 = easeOutBack(clamp01((t - 0.3) / 0.3));
    ctx.scale(k2, k2);
    ctx.rotate(0.02);
    mcText(ctx, 'WILL SAVE HIM?', 0, 128, 118, '#FFE14D', { shadow: '#6b4a00' });
    ctx.restore();
  }

  ending(ctx, t, W, H) {
    const F = ROUNDS[6];
    const tau = t - F.start;
    if (tau < F.survive) return;
    const k = easeOutBack(clamp01((tau - F.survive) / 0.3));
    const fadeS = clamp01((tau - (F.ask - 0.1)) / 0.2);
    if (fadeS < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - fadeS;
      ctx.translate(W / 2, 470);
      ctx.scale(k, k);
      ctx.rotate(-0.04 + Math.sin(tau * 4) * 0.02);
      mcText(ctx, 'SURVIVED!', 0, 0, 120, '#5BFF45', { shadow: '#0b4a00' });
      ctx.restore();
    }
    if (tau >= F.ask) {
      const k2 = easeOutBack(clamp01((tau - F.ask) / 0.3));
      ctx.save();
      ctx.translate(W / 2, 520);
      ctx.scale(k2, k2);
      mcText(ctx, 'WHICH ONE', 0, -60, 104, '#FFFFFF');
      mcText(ctx, 'WOULD YOU PICK?', 0, 60, 92, '#FFE14D', { shadow: '#6b4a00' });
      const bob = Math.sin(tau * 6) * 10;
      ctx.font = '96px "Noto Color Emoji"';
      ctx.textAlign = 'center';
      ctx.fillText('👇', 0, 190 + bob);
      ctx.restore();
    }
  }
}
