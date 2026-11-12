// Runs the real browser engine headlessly on one image.
// Usage: node tools/sketch.mjs <input> <output.png> ['{"darkness":1.2}'] [shortSide]
// Prints one JSON line with size, timings and the detected faces.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer } from './serve.mjs';

export async function sketch(page, baseUrl, input, params = {}, shortSide = 1400) {
  if (!page.url().startsWith(baseUrl)) await page.goto(baseUrl + '/blank.html');
  const b64 = fs.readFileSync(input).toString('base64');
  const mime = /\.png$/i.test(input) ? 'image/png' : /\.webp$/i.test(input) ? 'image/webp' : 'image/jpeg';
  return page.evaluate(async ({ b64, mime, params, shortSide }) => {
    const { PencilSketch } = await import('/js/pencil.js');
    const ps = (window.__ps ||= new PencilSketch({ shortSide }));
    const blob = await (await fetch(`data:${mime};base64,${b64}`)).blob();
    const r = await ps.process(blob, params);
    const c = document.createElement('canvas');
    c.width = r.width; c.height = r.height;
    c.getContext('2d').putImageData(r.imageData, 0, 0);
    return { png: c.toDataURL('image/png').split(',')[1], width: r.width, height: r.height, ms: r.ms, totalMs: r.totalMs, stats: r.stats, faces: r.faces };
  }, { b64, mime, params, shortSide });
}

export async function launch() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  return { browser, page };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [input, output, json, short] = process.argv.slice(2);
  if (!input || !output) { console.error('usage: node tools/sketch.mjs <input> <output.png> [paramsJson] [shortSide]'); process.exit(1); }
  const { server, url } = await startServer();
  const { browser, page } = await launch();
  try {
    const r = await sketch(page, url, input, json ? JSON.parse(json) : {}, Number(short) || 1400);
    fs.writeFileSync(output, Buffer.from(r.png, 'base64'));
    delete r.png;
    console.log(JSON.stringify(r));
  } finally { await browser.close(); server.close(); }
}
