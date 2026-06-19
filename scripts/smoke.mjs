/**
 * Headless smoke test — exercises the core user journeys against a running build.
 *
 * Set SMOKE_URL to point at a server (defaults to the `vite preview` port). Uses
 * the same puppeteer-core + @sparticuz/chromium stack as the other scripts here,
 * so it runs in CI and locally with no separate browser download. Exits non-zero
 * if any check fails or an unexpected page error occurs. The external Google
 * Fonts request is allowed to fail (it is blocked in sandboxed CI).
 *
 *   npm run build && (npx vite preview --port 4173 &) && npm run smoke
 */
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE = (process.env.SMOKE_URL || 'http://localhost:4173').replace(/\/$/, '');
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name); } };

const browser = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: await chromium.executablePath(), headless: chromium.headless });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.setViewport({ width: 1440, height: 1000 });
const waitSel = async (sel, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true; await sleep(150); } return false; };
const rectW = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().width) : 0; }, sel);
// Poll until an element has actually laid out (non-zero width) — the board mounts
// a frame before CSS sizes it, and the 3D canvas needs a beat after the toggle.
const waitWidth = async (sel, min = 100, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const w = await rectW(sel); if (w > min) return w; await sleep(200); } return rectW(sel); };

try {
  console.log(`Smoke against ${BASE}\nHome`);
  await page.goto(BASE + '/#/', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.skip-link');
  check('skip-to-content link present', !!(await page.$('.skip-link')));
  check('hero shader canvas renders', !!(await page.$('canvas.hh-bg')));
  check('sidebar nav present', (await page.$$('.sb-link')).length >= 5);
  check('games gallery lazy-loads cards', await waitSel('.game-card'));

  console.log('Game (chess) — 2D and 3D parity');
  await page.goto(BASE + '/#/play/chess', { waitUntil: 'networkidle0', timeout: 60000 });
  const w2d = await waitWidth('.board');
  // The board is a roving-tabindex grid — arrow keys move focus between cells.
  const kbd = await page.evaluate(async () => {
    const start = document.querySelector('.board [role="gridcell"][tabindex="0"]');
    if (!start) return false;
    start.focus();
    const before = document.activeElement?.getAttribute('data-idx');
    start.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    const after = document.activeElement?.getAttribute('data-idx');
    return !!before && !!after && before !== after;
  });
  check('board is keyboard-navigable (arrow key moves focus)', kbd);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.seg button')].find((x) => x.textContent.trim() === '3D'); if (b) b.click(); });
  const w3d = await waitWidth('.board3d');
  check('2D board renders with width', w2d > 100);
  check(`3D board matches 2D width (2D=${w2d}, 3D=${w3d})`, w2d > 100 && w3d > 100 && Math.abs(w3d - w2d) / w2d < 0.06);
  await sleep(2500); // let the WebGL scene finish initialising before we unmount it (a real user looks at the board; unmounting mid-init trips a drei/three teardown race)

  console.log('Profile — quests');
  await page.evaluate(() => { location.hash = '#/profile'; });
  await waitSel('.pf-quest');
  const prof = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pf-quest').length,
    weekly: [...document.querySelectorAll('.profile h2')].some((h) => /Weekly Quests/.test(h.textContent || '')),
  }));
  check('daily + weekly quest rows render (>=6)', prof.rows >= 6);
  check('Weekly Quests section present', prof.weekly);

  console.log('Shop');
  await page.evaluate(() => { location.hash = '#/shop'; });
  await waitSel('.shop');
  const shop = await page.evaluate(() => ({
    packs: document.querySelectorAll('.sh-coin-pack').length,
    items: document.querySelectorAll('.sh-item').length,
    pro: !!document.querySelector('.sh-pro-panel'),
  }));
  check('coin packs render', shop.packs === 3);
  check('cosmetics grid renders (>=14)', shop.items >= 14);
  check('Pro panel renders', shop.pro);
} catch (e) {
  fail++; console.log('  ✗ EXCEPTION:', e.message);
} finally {
  await browser.close();
}

const real = errors.filter((e) => !/ERR_CERT_AUTHORITY_INVALID|fonts\.googleapis|fonts\.gstatic/.test(e));
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (real.length) console.log('UNEXPECTED ERRORS:\n' + real.join('\n'));
process.exit(fail === 0 && real.length === 0 ? 0 : 1);
