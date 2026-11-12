// Draws the app icon (SVG below) and writes web/icons/* and mac/AppIcon.icns.
// Usage: node tools/make-icons.mjs   (needs Google Chrome and, for the .icns, macOS iconutil)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* inset = margin around the rounded square (macOS icons keep ~10 % free), radius of the square */
function iconSvg(inset, radius) {
  const s = 1024 - inset * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#efe2c4"/></linearGradient>
    <clipPath id="clip"><rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${radius}"/></clipPath>
    <pattern id="dots" width="46" height="46" patternUnits="userSpaceOnUse"><circle cx="23" cy="23" r="3" fill="#5d5a54" opacity="0.16"/></pattern>
  </defs>
  <rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${radius}" fill="url(#paper)"/>
  <g clip-path="url(#clip)">
    <rect x="0" y="0" width="1024" height="1024" fill="url(#dots)"/>
    <g fill="none" stroke="#2a2927" stroke-linecap="round" stroke-linejoin="round">
      <path d="M352 372c-6-92 62-158 150-156 90 2 152 70 146 160-6 86-66 150-150 148-82-2-141-64-146-152z" stroke-width="30"/>
      <path d="M236 812c14-150 114-232 262-232 96 0 172 36 218 104" stroke-width="30"/>
      <path d="M356 300c40-64 118-96 196-72 44 14 78 44 94 84" stroke-width="44" opacity="0.92"/>
      <g stroke-width="13" opacity="0.6">
        <path d="M300 720l78-70M318 772l120-108M372 794l104-94M228 468l64-58M222 532l104-94M250 574l70-64"/>
        <path d="M704 300l72-64M716 356l84-76M742 400l60-54"/>
      </g>
    </g>
    <g transform="rotate(-45 640 640)">
      <rect x="388" y="586" width="408" height="108" rx="10" fill="#f5b83d" stroke="#2a2927" stroke-width="22"/>
      <rect x="388" y="622" width="408" height="36" fill="#e09a17" opacity="0.55"/>
      <rect x="318" y="586" width="92" height="108" rx="30" fill="#ee8f8a" stroke="#2a2927" stroke-width="22"/>
      <rect x="398" y="586" width="44" height="108" fill="#cfd3d6" stroke="#2a2927" stroke-width="22"/>
      <path d="M796 586l150 54-150 54z" fill="#e9c99c" stroke="#2a2927" stroke-width="22" stroke-linejoin="round"/>
      <path d="M894 621l52 19-52 19z" fill="#2a2927"/>
    </g>
  </g>
  <rect x="${inset}" y="${inset}" width="${s}" height="${s}" rx="${radius}" fill="none" stroke="#2a2927" stroke-opacity="0.18" stroke-width="6"/>
</svg>`;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function png(svg, size, file, opaque) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:${opaque || 'transparent'}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: file, omitBackground: !opaque });
}

const web = path.join(ROOT, 'web', 'icons');
fs.mkdirSync(web, { recursive: true });
fs.writeFileSync(path.join(web, 'favicon.svg'), iconSvg(32, 220));
await png(iconSvg(0, 0), 180, path.join(web, 'apple-touch-icon.png'), '#f3ecdc');   // phones round the corners themselves
await png(iconSvg(0, 0), 192, path.join(web, 'icon-192.png'), '#f3ecdc');
await png(iconSvg(0, 0), 512, path.join(web, 'icon-512.png'), '#f3ecdc');

const set = fs.mkdtempSync(path.join(os.tmpdir(), 'pencil-icon-')) + '/AppIcon.iconset';
fs.mkdirSync(set);
const mac = iconSvg(100, 185);
for (const [size, name] of [[16, '16x16'], [32, '16x16@2x'], [32, '32x32'], [64, '32x32@2x'], [128, '128x128'], [256, '128x128@2x'],
  [256, '256x256'], [512, '256x256@2x'], [512, '512x512'], [1024, '512x512@2x']]) {
  await png(mac, size, path.join(set, `icon_${name}.png`));
}
await browser.close();
try {
  execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(ROOT, 'mac', 'AppIcon.icns')]);
  console.log('wrote mac/AppIcon.icns');
} catch (e) { console.log('iconutil not available, skipped the .icns'); }
console.log('wrote web/icons');
