import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let err = '';
page.on('pageerror', (e) => { err = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1320, height: 980 });
await page.goto('http://localhost:4209/#/play/breakthrough', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));
console.log('board cells:', await page.evaluate(() => document.querySelectorAll('.cell').length));
console.log('pieces:', await page.evaluate(() => document.querySelectorAll('.cell .piece, .cell .checker, .cell [class*="piece"]').length));
console.log('eval bar present:', await page.evaluate(() => !!document.querySelector('.eval-bar')));
// Play e2-e3 (cell 52 → 44) and let the AI reply.
await page.evaluate(() => document.querySelectorAll('.cell')[52]?.click());
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelectorAll('.cell')[44]?.click());
await new Promise((r) => setTimeout(r, 2200));
console.log('eval label:', await page.evaluate(() => document.querySelector('.eval-label')?.textContent || '(none)'));
console.log('move log rows:', await page.evaluate(() => document.querySelectorAll('.ml-row').length));
console.log('page error:', err || 'NONE');
const col = await page.$('.board-col');
if (col) await col.screenshot({ path: '/tmp/breakthrough.png' });
await browser.close();
console.log('SAVED /tmp/breakthrough.png');
