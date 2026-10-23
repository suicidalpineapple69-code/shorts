// 2D layer drawn over each frame: title, tier labels, word-by-word captions,
// the Minecraft-style chat command and the end-screen badges.

const COLORS = {
  '^': '#FF9A1F', // orange
  '*': '#FFE14D', // yellow
  '#': '#6BFF5A', // noob green
  $: '#FFC83D', // pro gold
  '!': '#FF4646', // hacker red
  '%': '#C77DFF', // god purple
};
const ACTIVE = '#FFE14D';
const PIXEL = 'Pixelify';
const CAPTION = 'Luckiest';

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function shadowOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgb(${(r * 0.25) | 0},${(g * 0.25) | 0},${(b * 0.25) | 0})`;
}

// Minecraft-style text: hard drop shadow in a darker shade, plus a dark outline
function mcText(ctx, str, x, y, size, color, { weight = 700, align = 'center', outline = 0.15, font = PIXEL } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const off = Math.max(2, Math.round(size * 0.085));
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * outline;
  ctx.strokeStyle = 'rgba(0,0,0,0.92)';
  ctx.strokeText(str, x + off, y + off);
  ctx.strokeText(str, x, y);
  ctx.fillStyle = shadowOf(color);
  ctx.fillText(str, x + off, y + off);
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function chunkLine(line) {
  const chunks = [];
  let cur = [];
  const flush = () => {
    if (cur.length) chunks.push(cur);
    cur = [];
  };
  for (const w of line.words) {
    cur.push(w);
    const text = cur.map((x) => x.w).join(' ');
    if (/[,.?!]$/.test(w.w) || cur.length >= 3 || text.length > 16) flush();
  }
  flush();
  return chunks.map((words, i) => ({
    words,
    start: words[0].start,
    end: i + 1 < chunks.length ? chunks[i + 1][0].start : line.end + 0.12,
  }));
}

export class Overlay {
  constructor(T) {
    this.T = T;
    this.chunks = T.vo.filter((l) => l.caption !== false).flatMap(chunkLine);
  }

  draw(ctx, t, view) {
    const { W, H } = view;
    this.rewind(ctx, t);
    this.title(ctx, t, W);
    this.label(ctx, t, W);
    this.chat(ctx, t, W, H);
    this.captions(ctx, t, W, H);
    this.badges(ctx, t, view);
    this.comment(ctx, t, W, H);
  }

  title(ctx, t, W) {
    const [a, b] = this.T.sections.hook;
    if (t >= b + 0.25) return;
    const pop = easeOutBack(clamp01((t - a - 0.04) / 0.32));
    const out = clamp01((t - b) / 0.25);
    ctx.save();
    ctx.globalAlpha = 1 - out;
    ctx.translate(W / 2, 300);
    ctx.scale(pop, pop);
    ctx.rotate(-0.035);
    const parts = [['NOOB', '#6BFF5A'], [' vs ', '#FFFFFF'], ['PRO', '#FFC83D'], [' vs ', '#FFFFFF'], ['HACKER', '#FF4646']];
    const size = 84;
    ctx.font = `700 ${size}px ${PIXEL}`;
    const widths = parts.map(([s], i) => {
      ctx.font = `700 ${i % 2 ? size * 0.7 : size}px ${PIXEL}`;
      return ctx.measureText(s).width;
    });
    const total = widths.reduce((p, q) => p + q, 0);
    const fit = Math.min(1, 960 / total);
    ctx.save();
    ctx.scale(fit, fit);
    let x = -total / 2;
    parts.forEach(([s, c], i) => {
      mcText(ctx, s, x + widths[i] / 2, 0, i % 2 ? size * 0.7 : size, c);
      x += widths[i];
    });
    ctx.restore();
    const pop2 = easeOutBack(clamp01((t - a - 0.22) / 0.32));
    ctx.scale(pop2, pop2);
    mcText(ctx, 'HALLOWEEN HOUSE', 0, 118, 112, '#FF9A1F');
    ctx.restore();
  }

  rewind(ctx, t) {
    const [a, b] = this.T.sections.rewind;
    if (t < a - 0.04 || t >= b) return;
    if (Math.floor(t * 12) % 3 === 2) return; // VHS flicker
    mcText(ctx, '<< REWIND', 70, 170, 46, '#FFFFFF', { font: 'PressStart', weight: 400, align: 'left' });
  }

  label(ctx, t, W) {
    const S = this.T.sections;
    const tiers = [
      ['NOOB', '#6BFF5A', S.noob, '1'],
      ['PRO', '#FFC83D', S.pro, '2'],
      ['HACKER', '#FF4646', S.hacker, '3'],
    ];
    for (const [name, color, [a, b], num] of tiers) {
      if (t < a || t >= b) continue;
      const k = easeOutBack(clamp01((t - a) / 0.3));
      const out = clamp01((t - (b - 0.15)) / 0.15);
      ctx.save();
      ctx.globalAlpha = 1 - out;
      ctx.translate(W / 2, 285);
      const wob = Math.sin((t - a) * 3.2) * 0.02;
      ctx.rotate(wob);
      ctx.scale(k * (1 + out * 0.3), k * (1 + out * 0.3));
      if (name === 'HACKER' && t - a < 0.5) {
        // glitchy entrance
        const j = Math.sin(t * 173) * 14 * (1 - (t - a) / 0.5);
        ctx.font = `700 150px ${PIXEL}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 0.7 * (1 - out);
        ctx.fillStyle = '#00FFFF';
        ctx.fillText(name, -j, 0);
        ctx.fillStyle = '#FF00FF';
        ctx.fillText(name, j, 4);
        ctx.globalAlpha = 1 - out;
      }
      mcText(ctx, name, 0, 0, 150, color);
      // tier number tag
      mcText(ctx, `#${num}`, 0, -122, 40, '#FFFFFF', { font: 'PressStart', weight: 400 });
      ctx.restore();
    }
  }

  chat(ctx, t, W, H) {
    const E = this.T.events;
    const open = E.chatOpen, close = E.chatEnter;
    if (t < open || t > close + 0.6) return;
    const text = this.T.chat;
    const [ta, tb] = E.chatType;
    // uneven typing rhythm
    let n = 0;
    for (let i = 0; i < text.length; i++) {
      const at = ta + (tb - ta) * Math.pow(i / text.length, 0.92) + Math.sin(i * 12.9898) * 0.012;
      if (t >= at) n = i + 1;
    }
    const y = H * 0.745;
    const x0 = 44;
    const boxW = W - 88;
    const fade = t > close ? 1 - clamp01((t - close - 0.3) / 0.3) : clamp01((t - open) / 0.12);
    ctx.save();
    ctx.globalAlpha = fade;
    if (t <= close) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(x0, y - 48, boxW, 96);
      ctx.font = `500 50px ${PIXEL}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const shown = text.slice(0, n);
      const cursor = Math.floor(t * 3.2) % 2 === 0 || n < text.length ? '_' : '';
      ctx.fillStyle = '#3F3F3F';
      ctx.fillText(shown + cursor, x0 + 24 + 4, y + 4);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(shown + cursor, x0 + 24, y);
    } else {
      // the command echoes into the chat history
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x0, y - 40, boxW, 80);
      ctx.font = `500 44px ${PIXEL}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#3F3F3F';
      ctx.fillText('Placed structure "pumpkin_mansion"', x0 + 24 + 4, y + 4);
      ctx.fillStyle = '#AAAAAA';
      ctx.fillText('Placed structure "pumpkin_mansion"', x0 + 24, y);
    }
    ctx.restore();
  }

  captions(ctx, t, W, H) {
    const c = this.chunks.find((k) => t >= k.start && t < k.end);
    if (!c) return;
    // under the moon on the end screen, mid-lower frame elsewhere
    const y = H * (t >= this.T.events.tilt[0] ? 0.665 : 0.615);
    const pop = easeOutBack(clamp01((t - c.start) / 0.11));
    const size = 104;
    ctx.save();
    ctx.translate(W / 2, y);
    ctx.scale(0.75 + 0.25 * pop, 0.75 + 0.25 * pop);
    ctx.font = `${size}px ${CAPTION}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    const words = c.words.map((w) => {
      const m = w.w.match(/^([\^*#$!%]?)(.*)$/);
      return { ...w, mark: m[1], text: m[2].toUpperCase() };
    });
    const space = size * 0.28;
    const widths = words.map((w) => ctx.measureText(w.text).width);
    let total = widths.reduce((p, q) => p + q, 0) + space * (words.length - 1);
    // fit inside the safe width
    const maxW = W * 0.84;
    const fit = Math.min(1, maxW / total);
    ctx.scale(fit, fit);
    let x = -total / 2;
    words.forEach((w, i) => {
      const active = t >= w.start && t < w.end + 0.02;
      const color = COLORS[w.mark] || (active ? ACTIVE : '#FFFFFF');
      const s = active ? 1.1 : 1;
      ctx.save();
      ctx.translate(x + widths[i] / 2, 0);
      ctx.scale(s, s);
      ctx.translate(-widths[i] / 2, 0);
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.24;
      ctx.strokeStyle = '#000000';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(w.text, 0, size * 0.09);
      ctx.strokeText(w.text, 0, 0);
      ctx.fillStyle = color;
      ctx.fillText(w.text, 0, 0);
      ctx.restore();
      x += widths[i] + space;
    });
    ctx.restore();
  }

  badges(ctx, t, view) {
    const E = this.T.events;
    const items = [
      ['1', 'NOOB', '#3FCF3A', view.badgeNoob, E.badges[0]],
      ['2', 'PRO', '#E8A317', view.badgePro, E.badges[1]],
      ['3', 'HACKER', '#E03232', view.badgeHack, E.badges[2]],
      ['4', 'GOD', '#9B4DFF', view.badgeMoon, E.badges[3]],
    ];
    for (const [num, name, color, p, at] of items) {
      if (t < at || !p) continue;
      const k = easeOutBack(clamp01((t - at) / 0.28)) * (num === '4' ? 1.35 : 1);
      const bob = Math.sin((t - at) * 4 + Number(num)) * 6;
      const sz = 118;
      ctx.save();
      ctx.translate(p[0], p[1] + bob);
      ctx.scale(k, k);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(-sz / 2 - 8, -sz / 2 - 8, sz + 16, sz + 16);
      ctx.fillStyle = color;
      ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(-sz / 2, -sz / 2, sz, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-sz / 2, sz / 2 - 12, sz, 12);
      mcText(ctx, num, 0, 6, 64, '#FFFFFF', { outline: 0.12, font: 'PressStart', weight: 400 });
      mcText(ctx, name, 0, sz / 2 + 52, 50, color === '#3FCF3A' ? '#6BFF5A' : color === '#E8A317' ? '#FFC83D' : color === '#E03232' ? '#FF4646' : '#C77DFF');
      ctx.restore();
    }
  }

  comment(ctx, t, W, H) {
    const at = this.T.events.comment;
    if (t < at) return;
    const k = easeOutBack(clamp01((t - at) / 0.3));
    const pulse = 1 + Math.sin((t - at) * 7) * 0.035;
    ctx.save();
    ctx.translate(W / 2, H * 0.735);
    ctx.scale(k * pulse, k * pulse);
    ctx.font = `100px ${CAPTION}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s = 'COMMENT 1, 2, 3 OR 4';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 24;
    ctx.strokeStyle = '#000';
    ctx.font = `78px ${CAPTION}`;
    ctx.strokeText(s, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(s, 0, 0);
    ctx.font = `110px "Noto Color Emoji"`;
    ctx.fillText('👇', 0, 118);
    ctx.restore();
  }
}
