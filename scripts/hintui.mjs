import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let pageErr = '';
page.on('pageerror', (e) => { pageErr = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1240, height: 980 });
await page.goto('http://localhost:4207/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Hint/.test(e.textContent || '')); b && b.click(); });
await new Promise((r) => setTimeout(r, 1800));
const hasLine = await page.evaluate(() => /Engine line:/.test(document.body.innerText));
console.log('hint shows engine line:', hasLine);
console.log('page error:', pageErr || 'NONE');
const col = await page.$('.side-col');
if (col) await col.screenshot({ path: '/tmp/hint.png' });
await browser.close();
console.log('SAVED /tmp/hint.png');
