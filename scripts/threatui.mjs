import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1024, height: 1100, deviceScaleFactor: 2 });
await page.goto('http://localhost:4213/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 800));
const clickText = (t) => page.evaluate((tx) => { const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes(tx)); if (b) b.click(); return !!b; }, t);
const cell = (i) => page.evaluate((n) => document.querySelectorAll('.cell')[n]?.click(), i);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await clickText('Setup'); await wait(250);
await clickText('Pass'); await wait(500); // Pass & Play — both sides human
// 1.e4 e5 2.Bc4 Bc5 3.Qh5  (threatens Qxf7#)
for (const [from, to] of [[52, 36], [12, 28], [61, 34], [5, 26], [59, 31]]) { await cell(from); await wait(160); await cell(to); await wait(380); }
await clickText('🧠 Tutor'); await wait(1200);
const warn = await page.evaluate(() => document.querySelector('.threat-warn')?.innerText || '(none)');
console.log('threat-warn:', JSON.stringify(warn));
const tutor = await page.$('.tutor');
if (tutor) await tutor.screenshot({ path: '/tmp/threat.png' });
await browser.close();
console.log('SAVED /tmp/threat.png');
