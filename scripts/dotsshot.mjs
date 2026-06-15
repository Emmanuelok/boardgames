import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 900, height: 1000, deviceScaleFactor: 1.5 });
await page.goto('http://localhost:4220/#/play/dots-and-boxes', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 800));
console.log('dots:', await page.evaluate(() => document.querySelectorAll('.db-dot').length), 'edges:', await page.evaluate(() => document.querySelectorAll('.db-edge').length), 'boxes:', await page.evaluate(() => document.querySelectorAll('.db-box').length));
// Play ~16 human moves (click a live edge), letting the AI reply between.
for (let i = 0; i < 16; i++) {
  const clicked = await page.evaluate(() => { const e = document.querySelector('.db-edge.live'); if (e) { e.click(); return true; } return false; });
  if (!clicked) break;
  await new Promise((r) => setTimeout(r, 650));
}
const claimed = await page.evaluate(() => document.querySelectorAll('.db-box.owned').length);
const drawn = await page.evaluate(() => document.querySelectorAll('.db-edge.on').length);
console.log('claimed boxes:', claimed, '| drawn edges:', drawn);
await page.screenshot({ path: '/tmp/dots.png' });
await browser.close();
console.log('SAVED');
