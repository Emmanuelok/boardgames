import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let pageErr = '';
page.on('pageerror', (e) => { pageErr = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1240, height: 980 });
await page.goto('http://localhost:4206/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));

const chip = () => page.evaluate(() => document.querySelector('.opening-chip strong')?.textContent || '(none)');
// Play 1.e4 (e2=52 → e4=36); the engine replies from its opening book.
await page.evaluate(() => document.querySelectorAll('.cell')[52]?.click());
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelectorAll('.cell')[36]?.click());
await new Promise((r) => setTimeout(r, 2400));
console.log('opening after 1.e4 + reply:', await chip());
console.log('page error:', pageErr || 'NONE');
const col = await page.$('.side-col');
if (col) await col.screenshot({ path: '/tmp/opening.png' });
await browser.close();
console.log('SAVED /tmp/opening.png');
