import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
let err = '';
page.on('pageerror', (e) => { err = e.message; console.log('PAGEERROR:', e.message); });
await page.setViewport({ width: 1320, height: 980 });
await page.goto('http://localhost:4210/#/learn/breakthrough', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1000));
console.log('mini-boards on page:', await page.evaluate(() => document.querySelectorAll('svg, .cell, [class*="mini"]').length > 0));
// Jump to the last chapter (Tactics Trainer) if a chapter nav exists.
await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].find((e) => /Tactics Trainer/.test(e.textContent || '')); b && b.click(); });
await new Promise((r) => setTimeout(r, 700));
console.log('home stat games:', await (async () => { const p2 = await browser.newPage(); await p2.goto('http://localhost:4210/#/', { waitUntil: 'networkidle0' }); await new Promise((r) => setTimeout(r, 600)); const t = await p2.evaluate(() => document.body.innerText.match(/(\d+)\s*\n?\s*games/i)?.[1] || (document.body.innerText.match(/(\d+)\+?\s*games/i)?.[1]) || '?'); await p2.close(); return t; })());
console.log('page error:', err || 'NONE');
await page.screenshot({ path: '/tmp/learnbt.png', fullPage: false });
await browser.close();
console.log('SAVED /tmp/learnbt.png');
