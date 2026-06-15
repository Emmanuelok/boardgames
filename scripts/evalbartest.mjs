import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let pageErr = '';
page.on('pageerror', (e) => { pageErr = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1240, height: 980 });
await page.goto('http://localhost:4205/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });

const read = () => page.evaluate(() => ({
  present: !!document.querySelector('.eval-bar'),
  label: document.querySelector('.eval-label')?.textContent || '',
  fill: document.querySelector('.eval-fill')?.style.height || '',
}));

await new Promise((r) => setTimeout(r, 1500));
console.log('opening:', JSON.stringify(await read()));

// Play 1.e4 — select e2 (cell index 52), then e4 (cell index 36).
await page.evaluate(() => document.querySelectorAll('.cell')[52]?.click());
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelectorAll('.cell')[36]?.click());
await new Promise((r) => setTimeout(r, 2600)); // human move + AI reply + analyze
console.log('after 1.e4 + reply:', JSON.stringify(await read()));
console.log('move log plies:', await page.evaluate(() => document.querySelectorAll('.ml-move').length || document.querySelectorAll('.ml-row').length));
console.log('page error:', pageErr || 'NONE');

const col = await page.$('.board-col');
if (col) await col.screenshot({ path: '/tmp/evalbar.png' });
await browser.close();
console.log('SAVED /tmp/evalbar.png');
