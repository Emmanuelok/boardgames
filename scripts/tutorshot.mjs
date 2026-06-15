import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1024, height: 1100, deviceScaleFactor: 2 });
await page.goto('http://localhost:4211/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));
// Play 1.e4 so the tutor shows a graded move with insights + principles.
await page.evaluate(() => document.querySelectorAll('.cell')[52]?.click());
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelectorAll('.cell')[36]?.click());
await new Promise((r) => setTimeout(r, 2600));
const tutor = await page.$('.tutor');
if (tutor) await tutor.screenshot({ path: '/tmp/tutor.png' });
await browser.close();
console.log('SAVED /tmp/tutor.png');
