import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1.5 });

await page.goto('http://localhost:4219/#/', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => document.querySelector('#games')?.scrollIntoView());
await new Promise((r) => setTimeout(r, 700));
console.log('catalogue cards:', await page.evaluate(() => document.querySelectorAll('.game-card').length));
console.log('variant badges:', await page.evaluate(() => [...document.querySelectorAll('.gc-variants')].map((e) => e.textContent)));
console.log('card names:', await page.evaluate(() => [...document.querySelectorAll('.gc-name')].map((e) => e.textContent)));
await page.screenshot({ path: '/tmp/catalogue.png' });

// Family play screen: chess should show a variant bar with Xiangqi/Shogi.
await page.goto('http://localhost:4219/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 700));
console.log('variant bar present:', await page.evaluate(() => !!document.querySelector('.variant-bar')));
console.log('variant options:', await page.evaluate(() => [...document.querySelectorAll('.variant-seg button, .variant-seg a')].map((e) => e.textContent)));
// Switch to Xiangqi via the bar.
await page.evaluate(() => { const a = [...document.querySelectorAll('.variant-seg a')].find((e) => /Xiangqi/.test(e.textContent)); a && a.click(); });
await new Promise((r) => setTimeout(r, 900));
console.log('after switch — url:', await page.evaluate(() => location.hash), 'title:', await page.evaluate(() => document.querySelector('.gs-title strong')?.textContent));
await page.screenshot({ path: '/tmp/variantbar.png' });
await browser.close();
console.log('SAVED');
