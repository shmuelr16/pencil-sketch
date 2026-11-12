// Renders the shareable ad (docs/ad/ad.html) and the repo banner (docs/ad/banner.html), same design as the site, to PNG.
// Usage: node tools/make-ad.mjs   -> docs/ad/after.jpg, docs/ad/pencil-sketch-ad-square.png (1080x1080), ...-story.png (1080x1920), docs/banner.png (1280x640)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './serve.mjs';
import { launch, sketch } from './sketch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'docs', 'ad');
const { server, url } = await startServer();
const { browser, page } = await launch();
try {
  /* the "after" half: the real engine on the bundled sample, saved as a JPG */
  const r = await sketch(page, url, path.join(ROOT, 'web', 'samples', 'sample.jpg'));
  const jpg = await page.evaluate(async (png) => {
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.src = 'data:image/png;base64,' + png; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, r.png);
  fs.writeFileSync(path.join(dir, 'after.jpg'), Buffer.from(jpg, 'base64'));

  const ad = pathToFileURL(path.join(dir, 'ad.html')).href;
  for (const [format, h] of [['square', 1080], ['story', 1920]]) {
    const p = await browser.newPage({ viewport: { width: 1080, height: h }, deviceScaleFactor: 1 });
    await p.goto(`${ad}?format=${format}`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const out = path.join(dir, `pencil-sketch-ad-${format}.png`);
    await p.screenshot({ path: out });
    await p.close();
    console.log('wrote ' + path.relative(ROOT, out));
  }
  /* repo banner (also fits GitHub's social preview: Settings > Social preview) */
  const b = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
  await b.goto(pathToFileURL(path.join(dir, 'banner.html')).href);
  await b.evaluate(() => document.fonts.ready);
  await b.waitForTimeout(300);
  await b.screenshot({ path: path.join(ROOT, 'docs', 'banner.png') });
  await b.close();
  console.log('wrote docs/banner.png');
} finally { await browser.close(); server.close(); }
