import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1440, height: 940 });

await page.goto('http://localhost:4208/#/', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1200));
await page.screenshot({ path: '/tmp/home.png' });
console.log('home saved');

await page.goto('http://localhost:4208/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));
// Play a few moves so the eval bar, opening chip and tutor are all populated.
await page.evaluate(() => document.querySelectorAll('.cell')[52]?.click());
await new Promise((r) => setTimeout(r, 200));
await page.evaluate(() => document.querySelectorAll('.cell')[36]?.click());
await new Promise((r) => setTimeout(r, 2600));
await page.screenshot({ path: '/tmp/chessfull.png' });
console.log('chess saved');
await browser.close();
