/**
 * Browser smoke test for the ten-system Strategy OS expansion.
 *
 * Run against a production preview:
 *   npm run preview -- --host 127.0.0.1 --port 4173
 *   npm run smoke:expansion
 *
 * Set EXPANSION_SCREENSHOT_DIR to save a full-page screenshot of every surface.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE = (process.env.SMOKE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCREENSHOT_DIR = process.env.EXPANSION_SCREENSHOT_DIR;
const errors = [];
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, passed: Boolean(ok), detail });
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

page.on('pageerror', (error) => errors.push(`PAGE: ${error.stack || error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error' || /^Failed to load resource:/.test(message.text())) return;
  errors.push(`CONSOLE: ${message.text()}`);
});
page.on('requestfailed', (request) => {
  if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) return;
  errors.push(`REQUEST: ${request.url()} — ${request.failure()?.errorText || 'failed'}`);
});

const route = async (id, hash, selector, heading) => {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(selector, { visible: true, timeout: 15_000 });
  const state = await page.evaluate(({ selector: rootSelector, headingText }) => {
    const overlay = document.querySelector('.vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]');
    const root = document.querySelector(rootSelector);
    return {
      hasRoot: Boolean(root),
      hasHeading: [...document.querySelectorAll('h1')].some((element) => element.textContent?.includes(headingText)),
      hasContent: (document.body.innerText || '').trim().length > 300,
      overlay: overlay?.textContent?.trim() || '',
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  }, { selector, headingText: heading });
  check(`${id} route renders meaningful content`, state.hasRoot && state.hasHeading && state.hasContent);
  check(`${id} route has no framework error overlay`, !state.overlay, state.overlay.slice(0, 160));
  check(`${id} route fits the desktop viewport`, !state.horizontalOverflow);
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${id}-desktop.png`), fullPage: true });
  }
};

try {
  if (SCREENSHOT_DIR) await mkdir(SCREENSHOT_DIR, { recursive: true });

  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // The smoke test still validates rendering when storage is unavailable.
    }
  });

  console.log('Strategy OS');
  await route('strategy-os', '/os', '.os-page', 'Everything now learns from the same move.');
  check('Strategy OS exposes all ten connected systems', await page.$$eval('.os-grid > article', (cards) => cards.length === 10));
  check('Strategy OS cards all lead to real routes', await page.$$eval('.os-grid > article a', (links) => (
    links.length === 10 && links.every((link) => link.getAttribute('href')?.startsWith('#/'))
  )));

  console.log('Intelligence Lab');
  await route('intelligence', '/intelligence', '.intelligence-lab', 'See how you think, not only whether you won.');
  check('Replay, DNA, transfer and coach tools are present', await page.$$eval('.il-tabs button', (tabs) => tabs.length === 4));
  await page.evaluate(() => [...document.querySelectorAll('.il-tabs button')]
    .find((button) => button.textContent?.includes('Strategy DNA'))?.click());
  await page.waitForSelector('#dna-title', { visible: true, timeout: 10_000 });
  check('Intelligence tabs change the active evidence surface', await page.evaluate(() => location.hash.includes('tab=dna')));

  console.log('Adventure campaigns');
  await route('adventures', '/adventures', '.adv-page', 'One strategic idea. Three worlds.');
  check('Three authored campaign worlds are selectable', await page.$$eval('.adv-switcher button', (buttons) => buttons.length === 3));
  check('Selected campaign renders a three-chapter evidence route', await page.$$eval('.adv-chapter', (chapters) => chapters.length === 3));
  check('Every chapter shows all five learning stages', await page.$$eval('.adv-stage-dots', (rows) => (
    rows.length === 3 && rows.every((row) => row.children.length === 5)
  )));

  console.log('Community and tournaments');
  await route('community', '/community', '.community-page', 'Strategy is better when the table remembers everyone.');
  check('Community separates lobby, clubs, tournaments and watch desk', await page.$$eval('.community-tabs button', (buttons) => buttons.length === 4));
  check('Curated clubs render with explicit learning focus', await page.$$eval('.club-grid .club-card', (cards) => cards.length === 3));
  await page.evaluate(() => [...document.querySelectorAll('.community-tabs button')]
    .find((button) => button.textContent?.includes('Tournaments'))?.click());
  await page.waitForSelector('.tournament-builder', { visible: true, timeout: 10_000 });
  await page.evaluate(() => [...document.querySelectorAll('.tournament-builder button')]
    .find((button) => button.textContent?.includes('Generate transparent bracket'))?.click());
  await page.waitForSelector('.bracket', { visible: true, timeout: 10_000 });
  check('Default four-player tournament generates a deterministic bracket', await page.$$eval('.bracket-match', (matches) => matches.length === 3));
  check('Community safety copy excludes stakes and paid entry', await page.evaluate(() => (
    /never a stake, entry fee or randomized prize/i.test(document.querySelector('.tournament-builder')?.textContent || '')
  )));

  console.log('Creator Studio');
  await route('creator', '/creator', '.creator-page', 'Turn a strategic idea into something another learner can play.');
  check('Creator supports puzzle, course and challenge formats', await page.$$eval('.creator-kind-tabs button', (buttons) => buttons.length === 3));
  check('Creator offers engine-derived legal move choices', await page.$$eval('.creator-special select option', (options) => options.length > 1));
  await page.type('.creator-fields input', 'Center Control Primer');
  await page.type('.creator-editor > label textarea', 'A focused position for learning how central influence creates options.');
  await page.type('.creator-special > label textarea', 'Find the legal move that claims useful central space.');
  await page.select('.creator-special select', await page.$eval('.creator-special select option:nth-child(2)', (option) => option.value));
  await page.evaluate(() => [...document.querySelectorAll('.creator-actions button')]
    .find((button) => button.textContent?.includes('Save draft'))?.click());
  await page.waitForSelector('.creation-grid article', { visible: true, timeout: 10_000 });
  check('Validated creator draft persists into the local library', await page.$$eval('.creation-grid article', (cards) => cards.length === 1));

  console.log('Physical-board scanner');
  await route('scanner', '/scanner', '.scanner-page', 'Bring a real board into GrandMaster');
  check('Scanner exposes all seven supported board serializers', await page.$$eval('.scanner-field select option', (options) => options.length === 7));
  check('Scanner requires choose, sample and verify stages', await page.$$eval('.scanner-step', (steps) => (
    steps.length === 3 && steps.map((step) => step.textContent).join(' ').includes('Verify the position')
  )));
  check('Scanner photo input supports direct camera capture', await page.$eval('input[type="file"]', (input) => (
    input.getAttribute('accept')?.includes('image') && input.getAttribute('capture') === 'environment'
  )));

  console.log('Accessibility and offline PWA');
  await route('settings', '/settings', '.settings-page', 'Accessibility & device settings');
  check('Accessibility suite exposes four preference groups', await page.$$eval('.settings-choices', (groups) => groups.length === 4));
  check('Accessibility suite exposes five independent clarity switches', await page.$$eval('.settings-toggle input[role="switch"]', (switches) => switches.length === 5));
  check('GrandMaster preserves its authored dark presentation by default', await page.evaluate(() => (
    document.documentElement.dataset.uiTheme === 'dark'
  )));
  await page.evaluate(() => document.querySelector('input[name="preference-appearance"][value="light"]')?.click());
  check('The explicit light theme applies immediately', await page.evaluate(() => (
    document.documentElement.dataset.uiTheme === 'light'
  )));
  await page.evaluate(() => [...document.querySelectorAll('.settings-toggle')]
    .find((label) => label.textContent?.includes('High contrast'))?.querySelector('input')?.click());
  check('High contrast applies immediately to the document', await page.evaluate(() => document.documentElement.dataset.contrast === 'high'));
  check('PWA status and offline download controls render', await page.evaluate(() => (
    Boolean(document.querySelector('.pwa-card'))
      && [...document.querySelectorAll('.pwa-card button')].some((button) => button.textContent?.includes('Download for offline'))
  )));
  check('Service worker registers on the production preview', await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  }));
  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.webmanifest');
    return response.ok ? response.json() : null;
  });
  check('Install manifest includes maskable and standard app icons', Boolean(
    manifest?.name
      && Array.isArray(manifest.icons)
      && manifest.icons.some((icon) => icon.purpose === 'maskable')
      && manifest.icons.some((icon) => icon.sizes === '192x192'),
  ));
  await page.evaluate(() => [...document.querySelectorAll('.pwa-card button')]
    .find((button) => button.textContent?.includes('Download for offline'))?.click());
  await page.waitForFunction(
    () => /Ready offline|Visited games remain available offline/.test(document.querySelector('.pwa-card')?.textContent || ''),
    { timeout: 60_000 },
  );
  check('Full-library download completes successfully', await page.evaluate(() => (
    /Ready offline/.test(document.querySelector('.pwa-card')?.textContent || '')
  )));
  // Reload once online so the active worker controls this tab, then force a
  // never-visited lazy route through the service worker with the network down.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.setOfflineMode(true);
  await page.goto(`${BASE}/?offline-smoke=1#/reviews`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.reviewhub', { visible: true, timeout: 15_000 });
  check('An unvisited lazy route opens after a real offline reload', await page.evaluate(() => (
    Boolean(document.querySelector('.reviewhub'))
      && !document.querySelector('.vite-error-overlay')
  )));
  await page.setOfflineMode(false);
  await page.goto(`${BASE}/#/os`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.os-page', { visible: true, timeout: 15_000 });
  check('Dark authored surfaces retain bright text inside the light theme', await page.evaluate(() => {
    const hero = document.querySelector('.os-hero h1');
    const navigation = document.querySelector('.sidebar .sb-link:not(.on)');
    if (!hero || !navigation) return false;
    const rgb = (value) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const heroColor = rgb(getComputedStyle(hero).color);
    const navColor = rgb(getComputedStyle(navigation).color);
    return heroColor.reduce((sum, value) => sum + value, 0) > 600
      && navColor.reduce((sum, value) => sum + value, 0) > 450;
  }));
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'strategy-os-light.png'), fullPage: true });
  }

  console.log('Responsive shell');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/#/os`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.os-page', { visible: true, timeout: 15_000 });
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    nav: document.querySelectorAll('.sb-link.mobile-primary').length,
    cards: document.querySelectorAll('.os-grid > article').length,
    desktopCtaHidden: getComputedStyle(document.querySelector('.sb-cta')).display === 'none',
  }));
  check('Mobile Strategy OS has no horizontal overflow', !mobile.overflow);
  check('Mobile shell keeps five primary navigation destinations', mobile.nav === 5);
  check('Mobile shell hides the desktop journey action', mobile.desktopCtaHidden);
  check('All ten systems remain available on mobile', mobile.cards === 10);
  if (SCREENSHOT_DIR) {
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'strategy-os-mobile.png'), fullPage: true });
  }

  check('Browser run produced no unexpected errors', errors.length === 0, errors.join(' | ').slice(0, 400));
  const passed = results.every((result) => result.passed);
  console.log(JSON.stringify({
    passed,
    checks: results.length,
    failed: results.filter((result) => !result.passed),
    errors,
    screenshots: SCREENSHOT_DIR || null,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await browser.close();
}
