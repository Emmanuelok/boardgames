import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1280, height: 980 });
for (const [id, port] of [['checkers', 4212], ['xiangqi', 4212]]) {
  await page.goto(`http://localhost:${port}/#/play/${id}`, { waitUntil: 'networkidle0', timeout: 40000 });
  await new Promise((r) => setTimeout(r, 1300));
  const info = await page.evaluate(() => ({ bar: !!document.querySelector('.eval-bar'), label: document.querySelector('.eval-label')?.textContent || '' }));
  console.log(`${id}: eval bar present=${info.bar} label=${info.label}`);
  if (id === 'checkers') { const col = await page.$('.board-col'); if (col) await col.screenshot({ path: '/tmp/checkers-eval.png' }); }
}
await browser.close();
console.log('SAVED /tmp/checkers-eval.png');
