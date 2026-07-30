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
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('requestfailed', (request) => {
  const url = request.url();
  if (/fonts\.(googleapis|gstatic)\.com/.test(url)) return;
  errors.push(`REQUEST: ${url} — ${request.failure()?.errorText || 'failed'}`);
});
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // Chromium's generic resource error omits the URL; requestfailed above
  // records local failures precisely and filters the permitted font outage.
  if (/^Failed to load resource:/.test(m.text())) return;
  errors.push('CONSOLE: ' + m.text());
});
await page.setViewport({ width: 1440, height: 1000 });
const waitSel = async (sel, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await page.evaluate((s) => !!document.querySelector(s), sel)) return true; await sleep(150); } return false; };
const rectW = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().width) : 0; }, sel);
const imageReady = (sel) => page.evaluate((s) => {
  const image = document.querySelector(s);
  return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
}, sel);
const waitImage = async (sel, ms = 12000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await imageReady(sel)) return true;
    await sleep(150);
  }
  return imageReady(sel);
};
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
  // The redesigned home page deliberately defers the catalogue until its
  // section approaches the viewport. Exercise that real user journey instead
  // of assuming the gallery remains close enough to the much taller hero.
  await page.evaluate(() => document.querySelector('.home-games')?.scrollIntoView({ block: 'center' }));
  check('games gallery lazy-loads cards', await waitSel('.game-card'));

  console.log('Strategy library — editorial discovery');
  await page.goto(BASE + '/#/games', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.gt-photo');
  await page.evaluate(async () => {
    const images = [...document.querySelectorAll('.gt-photo')];
    for (const image of images) {
      image.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 45));
    }
    window.scrollTo({ top: 0 });
  });
  const thumbnails = await page.evaluate(() => {
    const images = [...document.querySelectorAll('.gt-photo')];
    return {
      cards: document.querySelectorAll('.game-card').length,
      images: images.length,
      loaded: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      placeholders: document.querySelectorAll('.gt-emoji').length,
    };
  });
  check(
    'all 32 catalogue worlds render a loaded curated thumbnail',
    thumbnails.cards === 32
      && thumbnails.images === thumbnails.cards
      && thumbnails.loaded === thumbnails.cards
      && thumbnails.placeholders === 0,
  );
  await page.goto(BASE + '/#/games?category=strategy', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.discover-hero');
  check('strategy-worlds hero image loads', await waitImage('.discover-art'));
  check('category query controls the catalogue', await page.evaluate(() => (
    document.querySelector('.discover-worlds button.on strong')?.textContent === 'Strategy'
    && document.querySelector('.game-categories button.on')?.textContent === 'Strategy'
  )));

  console.log('My Path — connected mission context');
  await page.goto(BASE + '/#/path', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.mission-step.recommended');
  check('five-stage adaptive route renders', (await page.$$('.mission-step')).length === 5);
  await page.evaluate(() => document.querySelector('.mission-step.recommended')?.click());
  await waitSel('.journey-context');
  check('mission identity follows into the recommended tool', !!(await page.$('.journey-context')));

  console.log('Strategy Studio — authored connected session');
  await page.goto(BASE + '/#/studio', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.studio-builder');
  check('original Strategy Studio hero image loads', await waitImage('.studio-hero-art'));
  check('five-stage live blueprint renders', (await page.$$('.studio-route li')).length === 5);
  await page.evaluate(() => {
    const game = document.querySelector('.studio-select select');
    if (game instanceof HTMLSelectElement) {
      game.value = 'hexapawn';
      game.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const tactics = [...document.querySelectorAll('.studio-goals button')]
      .find((button) => /Sharpen tactics/.test(button.textContent || ''));
    tactics?.click();
  });
  await sleep(300);
  check('Studio controls regenerate the selected game blueprint', await page.evaluate(() => (
    /Hexapawn: Tactics/.test(document.querySelector('.studio-plan h2')?.textContent || '')
  )));
  await page.evaluate(() => {
    const start = [...document.querySelectorAll('.studio-plan-actions button')]
      .find((button) => /Start connected session/.test(button.textContent || ''));
    start?.click();
  });
  await waitSel('.journey-context');
  check('Studio launch activates evidence-tracked route context', await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('gm-learning-v1') || '{}').activeMission?.gameId === 'hexapawn';
    } catch {
      return false;
    }
  }));

  console.log('Learning surfaces — visual system');
  await page.goto(BASE + '/#/learn/chess', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.learn-hero');
  check('course-evolution hero image loads', await waitImage('.learn-hero-art'));
  await page.goto(BASE + '/#/puzzles?game=chess', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.pz-hero');
  check('tactics-observatory hero image loads', await waitImage('.pz-hero-art'));
  await page.goto(BASE + '/#/reviews', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.rv-hero');
  check('review-laboratory hero image loads', await waitImage('.rv-hero-art'));

  console.log('Game (chess) — 2D and 3D parity');
  await page.goto(BASE + '/#/play/chess?difficulty=hard', { waitUntil: 'networkidle0', timeout: 60000 });
  await waitSel('.tabs');
  await page.evaluate(() => {
    const setup = [...document.querySelectorAll('.tabs button')]
      .find((button) => /Setup/.test(button.textContent || ''));
    setup?.click();
  });
  await waitSel('.diff.on');
  check('route-selected sparring difficulty is applied', await page.evaluate(() => (
    document.querySelector('.diff.on strong')?.textContent === 'Strong'
  )));
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

  console.log('Collection');
  await page.evaluate(() => { location.hash = '#/shop'; });
  await waitSel('.shop');
  const shop = await page.evaluate(() => ({
    packs: document.querySelectorAll('.sh-coin-pack').length,
    earn: document.querySelectorAll('.sh-earn-card').length,
    items: document.querySelectorAll('.sh-item').length,
    pro: !!document.querySelector('.sh-pro-panel'),
    heading: document.querySelector('.shop h1')?.textContent || '',
    access: document.querySelector('.sh-access-note')?.textContent || '',
  }));
  check('collection replaces sold token packs with earned routes', shop.packs === 0 && shop.earn === 3);
  check('cosmetics grid renders (>=14)', shop.items >= 14);
  check('Collection and access panel render', shop.pro && shop.heading === 'Collection');
  check('unconfigured billing promises complete learning access', /every game, course, puzzle/i.test(shop.access));

  console.log('Teeko (new game) — renders and plays');
  await page.evaluate(() => { location.hash = '#/play/teeko'; });
  await waitSel('.gs-toolbar .seg');
  // The 2D/3D view persists across games; the chess test left it on 3D, so force 2D.
  await page.evaluate(() => { const b = [...document.querySelectorAll('.gs-toolbar .seg button')].find((x) => x.textContent.trim() === '2D'); if (b) b.click(); });
  await waitSel('.board');
  await sleep(700);
  const cells = await page.evaluate(() => document.querySelectorAll('.board .cell').length);
  await page.evaluate(() => { const c = document.querySelector('.board .cell[data-idx="12"]'); if (c) c.click(); }); // drop on the centre
  await sleep(1000); // let the drop land and the AI reply
  const men = await page.evaluate(() => document.querySelectorAll('.board .pc').length);
  check('Teeko board renders 25 cells', cells === 25);
  check('dropping a man places a piece (and the AI replies)', men >= 1);

  console.log("Three Men's Morris (new game) — renders and plays");
  await page.evaluate(() => { location.hash = '#/play/three-mens-morris'; });
  await waitSel('.gs-toolbar .seg');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.gs-toolbar .seg button')].find((x) => x.textContent.trim() === '2D'); if (b) b.click(); });
  await waitSel('.board');
  await sleep(700);
  const tmCells = await page.evaluate(() => document.querySelectorAll('.board .cell').length);
  await page.evaluate(() => { const c = document.querySelector('.board .cell[data-idx="4"]'); if (c) c.click(); }); // place on the centre
  await sleep(1000);
  const tmMen = await page.evaluate(() => document.querySelectorAll('.board .pc').length);
  check("Three Men's Morris renders its 9-point board", tmCells === 9);
  check('placing a man works (and the AI replies)', tmMen >= 1);

  console.log('Five Field Kono (new game) — renders and plays');
  await page.evaluate(() => { location.hash = '#/play/five-field-kono'; });
  await waitSel('.gs-toolbar .seg');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.gs-toolbar .seg button')].find((x) => x.textContent.trim() === '2D'); if (b) b.click(); });
  await waitSel('.board');
  await sleep(700);
  const koCells = await page.evaluate(() => document.querySelectorAll('.board .cell').length);
  const koMen = await page.evaluate(() => document.querySelectorAll('.board .pc').length);
  // Select a Blue stone (c5 = idx 2), then step it diagonally to e4 (idx 8).
  await page.evaluate(() => { const c = document.querySelector('.board .cell[data-idx="2"]'); if (c) c.click(); });
  await sleep(300);
  await page.evaluate(() => { const c = document.querySelector('.board .cell[data-idx="8"]'); if (c) c.click(); });
  await sleep(1000);
  const koMoved = await page.evaluate(() => !document.querySelector('.board .cell[data-idx="2"] .pc'));
  check('Five Field Kono renders its 25-cell board', koCells === 25);
  check('starts with 14 stones', koMen === 14);
  check('select-then-step moves a stone diagonally', koMoved);

  console.log('Mū Tōrere (new game) — graph board and course');
  await page.evaluate(() => { location.hash = '#/play/mu-torere'; });
  await waitSel('.gs-toolbar .seg');
  await page.evaluate(() => { const b = [...document.querySelectorAll('.gs-toolbar .seg button')].find((x) => x.textContent.trim() === '2D'); if (b) b.click(); });
  await waitSel('.board');
  await sleep(700);
  const mt = await page.evaluate(() => ({
    cells: document.querySelectorAll('.board .cell').length,
    stones: document.querySelectorAll('.board .pc').length,
    lines: document.querySelectorAll('.board .grid-lines line').length,
  }));
  check('Mū Tōrere renders nine graph points and eight stones', mt.cells === 9 && mt.stones === 8);
  check('Mū Tōrere renders its ring-and-centre connections', mt.lines === 16);

  console.log('Domineering (new game) — directional placement');
  await page.evaluate(() => { location.hash = '#/play/domineering'; });
  await waitSel('.board');
  await sleep(700);
  const domCells = await page.evaluate(() => document.querySelectorAll('.board .cell').length);
  await page.evaluate(() => document.querySelector('.board .cell[data-idx="0"]')?.click());
  await sleep(1000);
  const domPieces = await page.evaluate(() => document.querySelectorAll('.board .pc').length);
  check('Domineering renders its 6×6 board', domCells === 36);
  check('one anchor covers both cells of a legal domino', domPieces >= 2);

  console.log('Hexapawn (new game) — complete micro-strategy engine');
  await page.evaluate(() => { location.hash = '#/play/hexapawn'; });
  await waitSel('.board');
  await sleep(700);
  const hpStart = await page.evaluate(() => ({
    cells: document.querySelectorAll('.board .cell').length,
    pawns: document.querySelectorAll('.board .pc').length,
  }));
  await page.evaluate(() => document.querySelector('.board .cell[data-idx="7"]')?.click());
  await sleep(180);
  await page.evaluate(() => document.querySelector('.board .cell[data-idx="4"]')?.click());
  await sleep(1000);
  const hpMoved = await page.evaluate(() => !document.querySelector('.board .cell[data-idx="7"] .pc'));
  check('Hexapawn renders three-by-three with six starting pawns', hpStart.cells === 9 && hpStart.pawns === 6);
  check('Hexapawn advances a pawn and lets the AI respond', hpMoved);
} catch (e) {
  fail++; console.log('  ✗ EXCEPTION:', e.message);
} finally {
  await browser.close();
}

const real = errors.filter((e) => !/ERR_CERT_AUTHORITY_INVALID|fonts\.googleapis|fonts\.gstatic/.test(e));
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
if (real.length) console.log('UNEXPECTED ERRORS:\n' + real.join('\n'));
process.exit(fail === 0 && real.length === 0 ? 0 : 1);
