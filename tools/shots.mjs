// UI smoke test + screenshots: loads the page headlessly, runs the sample, moves a slider.
// Usage: node tools/shots.mjs [outDir=docs]   -> screen-empty.png, screen-desktop.png, screen-mobile.png
import path from 'node:path';
import { chromium, devices } from 'playwright-core';
import { startServer } from './serve.mjs';

const out = path.resolve(process.argv[2] || 'docs');
const { server, url } = await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let failed = false;

async function run(name, contextOptions, empty) {
  const ctx = await browser.newContext(contextOptions);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { failed = true; console.error(`[${name}] pageerror`, e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.error(`[${name}]`, m.text()); });
  await page.goto(url + '/');
  await page.waitForFunction(() => window.pencilReady === true);
  await page.waitForTimeout(2600);
  if (empty) await page.screenshot({ path: path.join(out, 'screen-empty.png') });
  const t0 = Date.now();
  await page.click('#sample');
  await page.waitForSelector('#savePng:not([disabled])', { timeout: 90000 });
  const firstMs = Date.now() - t0;
  await page.waitForTimeout(1500);
  const t1 = Date.now();
  await page.$eval('#darkness', (el) => { el.value = '1.3'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForFunction(() => document.getElementById('mini').hidden, null, { timeout: 30000 });
  const sliderMs = Date.now() - t1;
  await page.$eval('#reset', (el) => el.click());
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, `screen-${name}.png`), fullPage: name === 'mobile' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(JSON.stringify({ name, firstMs, sliderMs, horizontalOverflow: overflow, size: await page.$eval('#size', (e) => e.textContent) }));
  await ctx.close();
}

try {
  await run('desktop', { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 }, true);
  await run('mobile', { ...devices['iPhone 13'] });
} finally { await browser.close(); server.close(); }
process.exit(failed ? 1 : 0);
