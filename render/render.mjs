// Drives the renderer page in headless Chromium and encodes the frames.
//
//   node render/render.mjs                         full video -> build/video.mp4
//   node render/render.mjs --scale 0.5 --fps 15    quick preview
//   node render/render.mjs --stills 0.4,6.9,21.5   PNG stills -> build/stills/
//   node render/render.mjs --from 10 --to 12       a time range
//   node render/render.mjs --jobs 2                split the frames over two browsers
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright'));
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);

const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'timeline.json'), 'utf8'));
const scale = Number(args.scale || 1);
const W = Math.round((1080 * scale) / 2) * 2, H = Math.round((1920 * scale) / 2) * 2;
const fps = Number(args.fps || T.fps);
const jobs = Number(args.jobs || 1);

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT)) return res.writeHead(403).end();
      fs.readFile(p, (err, data) => {
        if (err) return res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function openPage(browser, port) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('page:', m.text());
  });
  await page.goto(`http://127.0.0.1:${port}/render/index.html`);
  await page.waitForFunction('window.ready === true', null, { timeout: 120000 });
  const info = await page.evaluate(([tl, o]) => window.init(tl, o), [T, { width: W, height: H }]);
  return { page, info };
}

async function frame(page, t) {
  const url = await page.evaluate((tt) => {
    window.renderFrame(tt);
    return window.grabFrame('image/png');
  }, t);
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
}

function encoder(out, rate) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(rate), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(args.crf || 14),
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-g', String(rate * 2), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
  return { ff, done };
}

async function main() {
  const srv = await serve();
  const port = srv.address().port;
  const launch = () => chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

  if (args.stills) {
    const browser = await launch();
    const { page, info } = await openPage(browser, port);
    console.log('scene', info);
    const dir = path.join(ROOT, 'build', 'stills');
    fs.mkdirSync(dir, { recursive: true });
    for (const s of String(args.stills).split(',')) {
      const t = Number(s);
      const t0 = Date.now();
      const png = await frame(page, t);
      const f = path.join(dir, `t${t.toFixed(2)}.png`);
      fs.writeFileSync(f, png);
      console.log(f, `${Date.now() - t0}ms`);
    }
    await browser.close();
    srv.close();
    return;
  }

  const from = Number(args.from || 0), to = Number(args.to || T.duration);
  const first = Math.round(from * fps), last = Math.round(to * fps);
  const total = last - first;
  const out = args.out ? path.resolve(args.out) : path.join(ROOT, 'build', scale < 1 ? 'preview.mp4' : 'video.mp4');
  const per = Math.ceil(total / jobs);
  const parts = [];
  const started = Date.now();
  let doneFrames = 0;
  await Promise.all(Array.from({ length: jobs }, async (_, j) => {
    const a = first + j * per, b = Math.min(last, a + per);
    if (a >= b) return;
    const part = jobs > 1 ? out.replace(/\.mp4$/, `.part${j}.mp4`) : out;
    parts[j] = part;
    const browser = await launch();
    const { page } = await openPage(browser, port);
    const { ff, done } = encoder(part, fps);
    for (let f = a; f < b; f++) {
      const png = await frame(page, f / fps);
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      doneFrames++;
      if (doneFrames % 30 === 0) {
        const el = (Date.now() - started) / 1000;
        console.log(`${doneFrames}/${total} frames  ${(el / doneFrames).toFixed(2)}s/frame  eta ${((total - doneFrames) * el / doneFrames / 60).toFixed(1)} min`);
      }
    }
    ff.stdin.end();
    await done;
    await browser.close();
  }));
  if (jobs > 1) {
    const list = out.replace(/\.mp4$/, '.txt');
    fs.writeFileSync(list, parts.filter(Boolean).map((p) => `file '${p}'`).join('\n'));
    await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { stdio: 'inherit' })
      .on('close', (c) => (c === 0 ? res() : rej(new Error('concat failed')))));
    for (const p of parts.filter(Boolean)) fs.unlinkSync(p);
    fs.unlinkSync(list);
  }
  console.log(`wrote ${out} (${total} frames in ${((Date.now() - started) / 60000).toFixed(1)} min)`);
  srv.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
