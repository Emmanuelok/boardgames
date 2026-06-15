import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/tmp/shot.png';
const w = Number(process.argv[4] || 1440);
const h = Number(process.argv[5] || 900);

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
const page = await browser.newPage();
await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto(url, { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1500));
const sel = process.argv[6];
if (sel) {
  const el = await page.$(sel);
  if (el) await el.screenshot({ path: out });
  else { console.log('selector not found: ' + sel); await page.screenshot({ path: out }); }
} else {
  await page.screenshot({ path: out });
}
await browser.close();
console.log('SAVED', out);
if (errs.length) console.log('CONSOLE ERRORS:\n' + errs.slice(0, 15).join('\n'));
