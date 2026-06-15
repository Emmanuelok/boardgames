import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let pageErr = '';
page.on('pageerror', (e) => { pageErr = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1240, height: 980 });
await page.goto('http://localhost:4203/#/play/backgammon', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));
const click = (txt) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes(t)); if (b) b.click(); return !!b; }, txt);

console.log('board rendered:', await page.evaluate(() => !!document.querySelector('.bg-board') && document.querySelectorAll('.bg-checker').length > 0));
console.log('play online btn:', await click('Play online')); await new Promise((r) => setTimeout(r, 300));
console.log('online panel:', await page.evaluate(() => !!document.querySelector('.bg-online')));
console.log('create room:', await click('Create room')); await new Promise((r) => setTimeout(r, 1200));
const info = await page.evaluate(() => ({
  code: document.querySelector('.online-code')?.textContent || '',
  status: document.querySelector('.online-status')?.textContent || '',
  hasCopy: !![...document.querySelectorAll('button')].find((e) => /Copy invite/.test(e.textContent || '')),
}));
console.log('after create:', JSON.stringify(info));
console.log('code is GM-pattern string:', /^GM-[A-Z0-9]{5}$/.test(info.code));
console.log('page error:', pageErr || 'NONE');
await page.screenshot({ path: '/tmp/bgonline.png' });
await browser.close();
console.log('SAVED /tmp/bgonline.png');
