import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 980 });
await page.goto('http://localhost:4194/#/play/backgammon', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((e) => /Roll/.test(e.textContent || '')); b && b.click(); });
await new Promise((r) => setTimeout(r, 900));
const after = await page.evaluate(() => ({
  dice: document.querySelectorAll('.die').length,
  sources: document.querySelectorAll('.bg-point.src').length,
}));
console.log('after roll:', JSON.stringify(after));
// select first source, count destinations
await page.evaluate(() => { const s = document.querySelector('.bg-point.src'); s && s.click(); });
await new Promise((r) => setTimeout(r, 500));
const sel = await page.evaluate(() => ({ dests: document.querySelectorAll('.bg-point.dest').length }));
console.log('after select:', JSON.stringify(sel));
await page.screenshot({ path: '/tmp/bg2.png' });
await browser.close();
console.log('SAVED /tmp/bg2.png');
