import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE = (process.env.SMOKE_URL || 'http://localhost:4173').replace(/\/$/, '');
const SCREENSHOT = process.env.THUMBNAIL_SCREENSHOT;
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
const page = await browser.newPage();
page.on('pageerror', (error) => errors.push(error.stack || error.message));
page.on('requestfailed', (request) => {
  if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) return;
  errors.push(`${request.url()} — ${request.failure()?.errorText || 'request failed'}`);
});

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/#/games`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.game-grid .game-card', { visible: true, timeout: 12000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.game-grid .game-card').length === 32,
    { timeout: 12000 },
  );

  const cards = await page.$$('.game-grid .game-card');
  for (const card of cards) {
    await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await sleep(55);
  }

  await page.waitForFunction(
    () => [...document.querySelectorAll('.gt-photo')]
      .every((image) => image.complete && image.naturalWidth > 0),
    { timeout: 15000 },
  );

  const result = await page.evaluate(() => {
    const images = [...document.querySelectorAll('.gt-photo')];
    return {
      cards: document.querySelectorAll('.game-grid .game-card').length,
      images: images.length,
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      uniqueSources: new Set(images.map((image) => image.currentSrc)).size,
      placeholders: document.querySelectorAll('.game-grid .gt-emoji').length,
      dimensions: [...new Set(images.map((image) => `${image.naturalWidth}x${image.naturalHeight}`))],
    };
  });

  await page.evaluate(() => window.scrollTo({ top: 0 }));
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT, fullPage: true });

  const passed = result.cards === 32
    && result.images === result.cards
    && result.loaded === result.cards
    && result.uniqueSources === result.cards
    && result.placeholders === 0
    && result.dimensions.length === 1
    && result.dimensions[0] === '1280x853'
    && errors.length === 0;

  console.log(JSON.stringify({ passed, result, errors, screenshot: SCREENSHOT }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
