import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let err = '';
page.on('pageerror', (e) => { err = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1280, height: 980 });
await page.goto('http://localhost:4217/#/play/amazons', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1000));
const glyphs = (g) => page.evaluate((ch) => [...document.querySelectorAll('.glyph')].filter((e) => e.textContent === ch).length, g);
const dots = () => page.evaluate(() => document.querySelectorAll('.dot').length);
const clickCell = (i) => page.evaluate((n) => document.querySelectorAll('.cell')[n]?.click(), i);

console.log('cells:', await page.evaluate(() => document.querySelectorAll('.cell').length), 'amazons:', await glyphs('♛'), 'arrows:', await glyphs('✕'), 'eval bar:', await page.evaluate(() => !!document.querySelector('.eval-bar')));
// Two-stage move: select White amazon c1 (idx 58) → move to c4 (idx 34) → shoot e4 (idx 36).
await clickCell(58); await new Promise((r) => setTimeout(r, 300));
console.log('after select amazon — dest dots:', await dots());
await clickCell(34); await new Promise((r) => setTimeout(r, 300));
console.log('after pick dest — arrow dots:', await dots(), 'pending highlight:', await page.evaluate(() => document.querySelectorAll('.hl.sel').length));
await clickCell(36); await new Promise((r) => setTimeout(r, 1200)); // commit + AI reply
console.log('after shoot — amazons:', await glyphs('♛'), 'arrows:', await glyphs('✕'));
console.log('c1 empty:', await page.evaluate(() => !document.querySelectorAll('.cell')[58].querySelector('.glyph')));
console.log('c4 has amazon:', await page.evaluate(() => document.querySelectorAll('.cell')[34].querySelector('.glyph')?.textContent === '♛'));
console.log('page error:', err || 'NONE');
const col = await page.$('.board-col'); if (col) await col.screenshot({ path: '/tmp/amazons.png' });
await browser.close();
console.log('SAVED');
