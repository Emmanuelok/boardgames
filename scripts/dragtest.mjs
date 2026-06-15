import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1240, height: 980 });
await page.goto('http://localhost:4218/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 900));
const box = (i) => page.evaluate((n) => { const el = document.querySelectorAll('.cell')[n]; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }, i);
const glyphAt = (i) => page.evaluate((n) => document.querySelectorAll('.cell')[n].querySelector('.pc')?.querySelector('svg') ? 'piece' : '(empty)', i);

console.log('e2 before:', await glyphAt(52), '| e4 before:', await glyphAt(36));
const e2 = await box(52), e4 = await box(36);
// Drag the e2 pawn to e4.
await page.mouse.move(e2.x, e2.y);
await page.mouse.down();
await page.mouse.move((e2.x + e4.x) / 2, (e2.y + e4.y) / 2, { steps: 6 });
await page.mouse.move(e4.x, e4.y, { steps: 6 });
await new Promise((r) => setTimeout(r, 100));
const ghost = await page.evaluate(() => !!document.querySelector('.drag-ghost'));
await page.mouse.up();
await new Promise((r) => setTimeout(r, 600));
console.log('ghost visible mid-drag:', ghost);
console.log('e2 after:', await glyphAt(52), '| e4 after:', await glyphAt(36));
const moved = (await glyphAt(52)) === '(empty)' && (await glyphAt(36)) === 'piece';
console.log('DRAG MOVED PAWN e2->e4:', moved);
await browser.close();
