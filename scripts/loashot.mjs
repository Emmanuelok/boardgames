import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1280, height: 980 });
await page.goto('http://localhost:4214/#/play/lines-of-action', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1300));
console.log('cells:', await page.evaluate(() => document.querySelectorAll('.cell').length));
console.log('pieces:', await page.evaluate(() => document.querySelectorAll('.cell [class*="piece"], .cell .checker, .cell svg circle').length));
console.log('eval bar:', await page.evaluate(() => !!document.querySelector('.eval-bar')), await page.evaluate(() => document.querySelector('.eval-label')?.textContent || ''));
// Select a Black man (b8 = index 1) to confirm legal-move highlighting works.
await page.evaluate(() => document.querySelectorAll('.cell')[1]?.click());
await new Promise((r) => setTimeout(r, 400));
console.log('targets highlighted after select:', await page.evaluate(() => document.querySelectorAll('.cell.target, .cell [class*="target"], .target').length));
const col = await page.$('.board-col');
if (col) await col.screenshot({ path: '/tmp/loa.png' });
await browser.close();
console.log('SAVED /tmp/loa.png');
