// Side-by-side check that the browser engine still looks like reference/pencil.py.
// Usage: node tools/compare.mjs [input=web/samples/sample.jpg] [output=docs/compare.png] [--python /path/to/python] [--py-out existing.png]
// The Python needs opencv-python and numpy (it takes about a minute and a half; GrabCut is slow).
// Note: the reference script has the eye boxes of one specific photo hard-coded, so the input must have
// its eyes there (web/samples/sample.jpg was cropped that way: eye centres at x 605/795, y 517, 1400 px wide).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer } from './serve.mjs';
import { launch, sketch } from './sketch.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const python = opt('--python', 'python3');
let pyOut = opt('--py-out', null);
const input = path.resolve(args[0] || 'web/samples/sample.jpg');
const output = path.resolve(args[1] || 'docs/compare.png');

if (!pyOut) {
  pyOut = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pencil-')), 'py.png');
  console.log('running reference/pencil.py …');
  const t0 = Date.now();
  execFileSync(python, ['reference/pencil.py', input, pyOut], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`python: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const { server, url } = await startServer();
const { browser, page } = await launch();
try {
  const js = await sketch(page, url, input);
  console.log(`js: ${(js.ms / 1000).toFixed(1)} s engine, ${(js.totalMs / 1000).toFixed(1)} s total, faces ${js.stats.faces}`);
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  const out = await page.evaluate(async ({ orig, py, jsPng, jsMs }) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const imgs = [await load('data:image/jpeg;base64,' + orig), await load('data:image/png;base64,' + py), await load('data:image/png;base64,' + jsPng)];
    const labels = ['Original photo', 'Python reference (reference/pencil.py)', `JavaScript engine (opencv.js, ${(jsMs / 1000).toFixed(1)} s)`];
    const h = 1100, pad = 24, head = 64;
    const ws = imgs.map((i) => Math.round(i.width * h / i.height));
    const c = document.createElement('canvas');
    c.width = ws.reduce((a, b) => a + b, 0) + pad * 4; c.height = h + head + pad;
    const g = c.getContext('2d');
    g.fillStyle = '#f3ecdc'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    let x = pad;
    imgs.forEach((im, i) => {
      g.drawImage(im, x, head, ws[i], h);
      g.strokeStyle = '#2a2927'; g.lineWidth = 2; g.strokeRect(x, head, ws[i], h);
      g.fillStyle = '#2a2927'; g.font = '600 26px system-ui, sans-serif'; g.textBaseline = 'middle';
      g.fillText(labels[i], x, head / 2 + 2);
      x += ws[i] + pad;
    });
    return c.toDataURL('image/png').split(',')[1];
  }, { orig: b64(input), py: b64(pyOut), jsPng: js.png, jsMs: js.ms });
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, Buffer.from(out, 'base64'));
  console.log('wrote ' + path.relative(process.cwd(), output));
} finally { await browser.close(); server.close(); }
