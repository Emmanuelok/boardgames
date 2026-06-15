import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.goto('http://localhost:4185/#/learn/chess', { waitUntil: 'networkidle0', timeout: 40000 });
await new Promise((r) => setTimeout(r, 1200));
// open the royal fork lesson
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.nav-step')].find((e) => e.textContent.includes('royal fork'));
  el && el.click();
});
await new Promise((r) => setTimeout(r, 700));
// click knight (cell 34 = c4) then destination (cell 19 = d6)
const clickCell = (idx) => page.evaluate((i) => {
  const cells = document.querySelectorAll('.lesson-interactive .cell');
  cells[i] && cells[i].click();
}, idx);
await clickCell(34);
await new Promise((r) => setTimeout(r, 300));
await clickCell(19);
await new Promise((r) => setTimeout(r, 600));
const prompt = await page.evaluate(() => {
  const el = document.querySelector('.challenge-prompt');
  return { text: el?.textContent || '', cls: el?.className || '' };
});
console.log('RESULT class:', prompt.cls);
console.log('RESULT text:', prompt.text.slice(0, 120));
await page.screenshot({ path: '/tmp/solved.png' });
await browser.close();
console.log('SAVED /tmp/solved.png');
