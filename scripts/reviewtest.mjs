import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 940 });
await page.goto('http://localhost:4189/#/play/tic-tac-toe', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1000));
const clickText = (t) => page.evaluate((txt) => {
  const el = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes(txt));
  if (el) el.click();
}, t);
const clickCell = (i) => page.evaluate((idx) => {
  const cells = document.querySelectorAll('.board .cell');
  cells[idx] && cells[idx].click();
}, i);

await clickText('Setup'); await new Promise((r) => setTimeout(r, 300));
await clickText('Pass & Play'); await new Promise((r) => setTimeout(r, 500));
await clickText('Tutor'); await new Promise((r) => setTimeout(r, 300));
// X wins the top row: X0 O8 X1 O7 X2
for (const c of [0, 8, 1, 7, 2]) { await clickCell(c); await new Promise((r) => setTimeout(r, 450)); }
await new Promise((r) => setTimeout(r, 1500));
const txt = await page.evaluate(() => document.querySelector('.review')?.textContent || 'NO REVIEW');
console.log('REVIEW:', txt.slice(0, 160));
const panel = await page.$('.side-col');
if (panel) await panel.screenshot({ path: '/tmp/review.png' });
else await page.screenshot({ path: '/tmp/review.png' });
await browser.close();
console.log('SAVED /tmp/review.png');
