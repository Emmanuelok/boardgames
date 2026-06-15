import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERR:', m.text().slice(0, 200)); });
await page.setViewport({ width: 1240, height: 940 });
await page.goto('http://localhost:4202/#/play/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 800));
const click = (txt) => page.evaluate((t) => { const b = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').includes(t)); if (b) b.click(); return !!b; }, txt);
console.log('setup tab:', await click('Setup')); await new Promise((r) => setTimeout(r, 250));
console.log('online btn:', await click('Online')); await new Promise((r) => setTimeout(r, 250));
console.log('create room:', await click('Create room')); await new Promise((r) => setTimeout(r, 700));
console.log('tabs now:', await page.evaluate(() => [...document.querySelectorAll('.tab')].map((b) => b.textContent)));
console.log('chat tab:', await click('Chat')); await new Promise((r) => setTimeout(r, 400));
const hasInput = await page.evaluate(() => !!document.querySelector('.chat-input input'));
console.log('chat input present:', hasInput);
if (hasInput) {
  await page.type('.chat-input input', 'gl hf!');
  await click('Send'); await new Promise((r) => setTimeout(r, 400));
  console.log('my messages:', await page.evaluate(() => document.querySelectorAll('.chat-msg.me').length));
}
const panel = await page.$('.side-col');
if (panel) await panel.screenshot({ path: '/tmp/chat.png' });
await browser.close();
console.log('SAVED /tmp/chat.png');
