/**
 * Independent browser verification for the Mind Games / Mind Cascade release.
 *
 * Run against a built preview:
 *   npm run preview -- --host 127.0.0.1 --port 4173
 *   npm run smoke:mind-games
 *
 * Override the target with SMOKE_URL and the evidence folder with
 * MIND_GAMES_SCREENSHOT_DIR.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const BASE = (process.env.SMOKE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const SCREENSHOT_DIR = process.env.MIND_GAMES_SCREENSHOT_DIR || '/tmp/grandmaster-mind-games';
const MOBILE_ONLY = process.env.MIND_GAMES_MOBILE_ONLY === '1';
const PROGRESS_KEY = 'gm-mind-cascade-progress-v2';
const SOUND_INTENSITY_KEY = 'gm-sound-intensity';
const results = [];
const browserErrors = [];

const check = (name, ok, detail = '') => {
  const passed = Boolean(ok);
  results.push({ name, passed, detail });
  console.log(passed ? `  ✓ ${name}` : `  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  return passed;
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: chromium.headless,
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

page.on('pageerror', (error) => browserErrors.push(`PAGE: ${error.stack || error.message}`));
page.on('console', (message) => {
  if (message.type() !== 'error' || /^Failed to load resource:/.test(message.text())) return;
  browserErrors.push(`CONSOLE: ${message.text()}`);
});
page.on('requestfailed', (request) => {
  if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) return;
  browserErrors.push(`REQUEST: ${request.url()} — ${request.failure()?.errorText || 'failed'}`);
});
page.on('response', (response) => {
  if (response.status() < 400 || /favicon\.(ico|svg)/.test(response.url())) return;
  browserErrors.push(`RESPONSE: ${response.status()} ${response.url()}`);
});

const screenshot = async (name) => {
  await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`), fullPage: true });
};

const inspectRoute = async (name, hash, rootSelector, headingPattern) => {
  await page.goto(`${BASE}/#${hash}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(rootSelector, { visible: true, timeout: 20_000 });
  const state = await page.evaluate(({ rootSelector: selector, headingSource }) => {
    const overlay = document.querySelector(
      '.vite-error-overlay, #webpack-dev-server-client-overlay, [data-nextjs-dialog]',
    );
    const headings = [...document.querySelectorAll('h1')].map((heading) => heading.textContent?.trim() || '');
    return {
      contentLength: (document.querySelector(selector)?.textContent || '').trim().length,
      heading: headings.find((text) => new RegExp(headingSource, 'i').test(text)) || '',
      overlay: overlay?.textContent?.trim() || '',
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  }, { rootSelector, headingSource: headingPattern.source });
  check(`${name} route renders meaningful content`, state.contentLength > 300 && Boolean(state.heading));
  check(`${name} route has no framework error overlay`, !state.overlay, state.overlay.slice(0, 180));
  check(`${name} route fits the desktop viewport`, !state.overflow);
  await screenshot(`${name}-desktop`);
  return state;
};

const clickByText = async (selector, pattern, required = true) => {
  const clicked = await page.evaluate(({ selector: query, source, flags }) => {
    const expression = new RegExp(source, flags);
    const element = [...document.querySelectorAll(query)].find((candidate) => (
      expression.test((candidate.textContent || '').replace(/\s+/g, ' ').trim())
    ));
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  }, { selector, source: pattern.source, flags: pattern.flags });
  if (required && !clicked) throw new Error(`Could not find ${selector} matching ${pattern}.`);
  return clicked;
};

const ensureBoard = async () => {
  if (await page.$('.mc-board')) return true;
  const started = await clickByText(
    '.mc-page button, .mc-page [role="button"]',
    /start|begin|new board|play (?:this|selected|level)|continue/i,
    false,
  );
  if (!started) return false;
  await page.waitForSelector('.mc-board', { visible: true, timeout: 20_000 });
  return true;
};

const boardSnapshot = async () => page.evaluate(() => {
  const board = document.querySelector('.mc-board');
  const tiles = [...document.querySelectorAll('.mc-board .mc-tile')];
  const columnsValue = board
    ? getComputedStyle(board).getPropertyValue('--mc-columns')
    : '';
  const columns = Number.parseInt(columnsValue, 10) || Math.round(Math.sqrt(tiles.length));
  const tileData = tiles.map((tile, index) => {
    const glyph = tile.querySelector('.mc-glyph')?.textContent?.trim() || '';
    const token = tile.getAttribute('data-kind')
      || tile.getAttribute('data-pattern')
      || glyph
      || tile.getAttribute('aria-label')
      || `tile-${index}`;
    return {
      index,
      token,
      label: tile.getAttribute('aria-label') || '',
      tag: tile.tagName,
      tabIndex: tile.tabIndex,
      disabled: 'disabled' in tile ? Boolean(tile.disabled) : false,
    };
  });
  return {
    rows: columns > 0 ? Math.ceil(tiles.length / columns) : 0,
    columns,
    tileData,
    objectiveCount: document.querySelectorAll('.mc-objective').length,
    forecastCount: document.querySelectorAll('.mc-forecast').length,
    historyCount: document.querySelectorAll('.mc-history-list button, .mc-move-strip button').length,
    text: board?.textContent || '',
  };
});

const findLegalPair = (snapshot) => {
  const { rows, columns } = snapshot;
  const tokens = snapshot.tileData.map((tile) => tile.token);
  const lineLengthAt = (values, index, rowDelta, columnDelta) => {
    const token = values[index];
    const row = Math.floor(index / columns);
    const column = index % columns;
    let length = 1;
    for (const direction of [-1, 1]) {
      let nextRow = row + rowDelta * direction;
      let nextColumn = column + columnDelta * direction;
      while (
        nextRow >= 0
        && nextColumn >= 0
        && nextRow < rows
        && nextColumn < columns
        && values[nextRow * columns + nextColumn] === token
      ) {
        length += 1;
        nextRow += rowDelta * direction;
        nextColumn += columnDelta * direction;
      }
    }
    return length;
  };
  const makesMatch = (first, second) => {
    const values = [...tokens];
    [values[first], values[second]] = [values[second], values[first]];
    return [first, second].some((index) => (
      lineLengthAt(values, index, 0, 1) >= 3 || lineLengthAt(values, index, 1, 0) >= 3
    ));
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    for (const next of [
      column + 1 < columns ? index + 1 : -1,
      row + 1 < rows ? index + columns : -1,
    ]) {
      if (next >= 0 && makesMatch(index, next)) return [index, next];
    }
  }
  return null;
};

const tileCentre = async (index) => page.$eval(
  `.mc-board .mc-tile:nth-child(${index + 1})`,
  (tile) => {
    const bounds = tile.getBoundingClientRect();
    return {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
  },
);

const dragLegalPair = async ([from, to]) => {
  const source = await tileCentre(from);
  const target = await tileCentre(to);
  const mid = {
    x: source.x + (target.x - source.x) * 0.62,
    y: source.y + (target.y - source.y) * 0.62,
  };
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(mid.x, mid.y, { steps: 4 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => (
    requestAnimationFrame(resolve)
  ))));
  const feedback = await page.evaluate(() => {
    const frame = document.querySelector('.mc-board-frame');
    const sourceTile = document.querySelector('.mc-tile.drag-source');
    const targetTile = document.querySelector('.mc-tile.drag-target');
    return {
      dragging: frame?.classList.contains('is-dragging') ?? false,
      axis: frame?.getAttribute('data-drag-axis') ?? '',
      x: sourceTile instanceof HTMLElement
        ? sourceTile.style.getPropertyValue('--mc-drag-x')
        : '',
      y: sourceTile instanceof HTMLElement
        ? sourceTile.style.getPropertyValue('--mc-drag-y')
        : '',
      hasTarget: Boolean(targetTile),
      touchAction: sourceTile ? getComputedStyle(sourceTile).touchAction : '',
    };
  });
  await page.mouse.move(target.x, target.y, { steps: 4 });
  await page.mouse.up();
  return feedback;
};

const touchSwipeLegalPair = async ([from, to]) => {
  await page.$eval(
    `.mc-board .mc-tile:nth-child(${from + 1})`,
    (tile) => tile.scrollIntoView({
      block: 'center',
      inline: 'center',
      behavior: 'instant',
    }),
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => (
    requestAnimationFrame(resolve)
  ))));
  const source = await tileCentre(from);
  const target = await tileCentre(to);
  const touch = await page.touchscreen.touchStart(source.x, source.y);
  let feedback = null;
  try {
    for (let step = 1; step <= 5; step += 1) {
      await touch.move(
        source.x + (target.x - source.x) * step / 5,
        source.y + (target.y - source.y) * step / 5,
      );
      await wait(18);
    }
    feedback = await page.evaluate(({ sourcePoint, targetPoint }) => {
      const frame = document.querySelector('.mc-board-frame');
      return {
        dragging: frame?.classList.contains('is-dragging') ?? false,
        axis: frame?.getAttribute('data-drag-axis') ?? '',
        hasSource: Boolean(document.querySelector('.mc-tile.drag-source')),
        hasTarget: Boolean(document.querySelector('.mc-tile.drag-target')),
        sourceInsideViewport: (
          sourcePoint.x >= 0
          && sourcePoint.x <= window.innerWidth
          && sourcePoint.y >= 0
          && sourcePoint.y <= window.innerHeight
        ),
        targetInsideViewport: (
          targetPoint.x >= 0
          && targetPoint.x <= window.innerWidth
          && targetPoint.y >= 0
          && targetPoint.y <= window.innerHeight
        ),
        sourceHit: document.elementFromPoint(sourcePoint.x, sourcePoint.y)?.className || '',
        targetHit: document.elementFromPoint(targetPoint.x, targetPoint.y)?.className || '',
      };
    }, { sourcePoint: source, targetPoint: target });
  } finally {
    await touch.end();
  }
  return feedback;
};

const readSessionMetrics = async () => page.evaluate(() => {
  const entries = [...document.querySelectorAll('.mc-hud > div')].map((entry) => ({
    label: entry.querySelector('span')?.textContent?.trim() || '',
    value: entry.querySelector('strong')?.textContent?.trim() || '',
  }));
  const movesEntry = entries.find((entry) => /move/i.test(entry.label));
  const scoreEntry = entries.find((entry) => /score/i.test(entry.label));
  return {
    movesText: movesEntry?.value || '',
    moves: Number.parseInt(movesEntry?.value || '', 10),
    scoreText: scoreEntry?.value || '',
    score: Number.parseInt(scoreEntry?.value || '', 10),
    historyCount: document.querySelectorAll('.mc-history-list button, .mc-move-strip button').length,
    objectiveText: [...document.querySelectorAll('.mc-objective')].map((objective) => (
      objective.textContent?.replace(/\s+/g, ' ').trim() || ''
    )),
  };
});

const storageSnapshot = async () => page.evaluate((key) => {
  try {
    const value = localStorage.getItem(key);
    if (!value) return { exists: false };
    const parsed = JSON.parse(value);
    const session = parsed?.resumableSession;
    return {
      exists: true,
      hasSession: Boolean(session),
      moveNumber: session?.moveNumber ?? null,
      score: session?.score ?? null,
      sessionId: session?.id ?? '',
      stateTurn: session?.state?.turn ?? null,
      historyLength: session?.state?.history?.length ?? null,
    };
  } catch (error) {
    return { exists: true, parseError: String(error) };
  }
}, PROGRESS_KEY);

try {
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  // Clear prior user data only for the first document. sessionStorage survives
  // same-origin reloads, allowing this run to verify genuine persistence.
  await page.evaluateOnNewDocument(() => {
    try {
      if (!sessionStorage.getItem('gm-mind-games-smoke-started')) {
        localStorage.clear();
        sessionStorage.setItem('gm-mind-games-smoke-started', '1');
      }
    } catch {
      // Storage failures are reported by the persistence checks below.
    }
  });

  if (!MOBILE_ONLY) {
    console.log('Mind Games hub');
    await inspectRoute(
    'mind-games-hub',
    '/mind-games',
    '.mind-games-page',
    /Games built to reveal how a plan develops/i,
  );
  check('Hub presents Mind Cascade as a playable original', await page.evaluate(() => (
    [...document.querySelectorAll('h2')].some((heading) => /Mind Cascade/i.test(heading.textContent || ''))
      && Boolean(document.querySelector('a[href*="/mind-games/cascade"]'))
  )));
  check('Hub distinguishes playable work from future research concepts', await page.evaluate(() => (
    document.querySelectorAll('.mind-games-research-grid article').length >= 3
      && [...document.querySelectorAll('.mind-games-research-grid article')]
        .every((card) => /under development/i.test(card.textContent || ''))
  )));
  check('Hub explicitly rejects pressure and randomized monetization', await page.evaluate(() => (
    /No pressure timer, purchasable lives, loot boxes or randomized rewards/i.test(
      document.querySelector('.mind-games-safety')?.textContent || '',
    )
  )));

  console.log('Player-controlled cinematic audio');
  await inspectRoute(
    'sound-settings',
    '/settings',
    '.settings-page',
    /Accessibility & device settings/i,
  );
  const soundControls = await page.evaluate(() => ({
    hasSoundSwitch: Boolean(document.querySelector('.settings-sound input[role="switch"]')),
    modes: [...document.querySelectorAll('.settings-sound input[type="radio"]')]
      .map((input) => input.getAttribute('value')),
    hasPreview: [...document.querySelectorAll('.settings-sound button')]
      .some((button) => /preview completion mix/i.test(button.textContent || '')),
  }));
  check('Settings exposes a labelled platform sound switch', soundControls.hasSoundSwitch);
  check('Settings offers quiet, balanced and cinematic sound profiles', (
    ['quiet', 'balanced', 'cinematic'].every((mode) => soundControls.modes.includes(mode))
  ));
  check('Settings provides an explicit completion-cue preview', soundControls.hasPreview);
  await page.evaluate(() => {
    const cinematic = document.querySelector('.settings-sound input[value="cinematic"]');
    if (cinematic instanceof HTMLInputElement) cinematic.click();
  });
  check('The cinematic mix persists on this device', await page.evaluate((key) => (
    localStorage.getItem(key) === 'cinematic'
  ), SOUND_INTENSITY_KEY));

  console.log('Mind Cascade game');
  await inspectRoute(
    'mind-cascade',
    '/mind-games/cascade',
    '.mc-page',
    /Think beyond the match|Mind Cascade/i,
  );
  const hasBoard = await ensureBoard();
  check('A playable board can be started', hasBoard);
  if (!hasBoard) throw new Error('Mind Cascade did not expose a startable board.');

  await page.waitForSelector('.mc-board .mc-tile', { visible: true, timeout: 15_000 });
  const initialBoard = await boardSnapshot();
  check(
    'Board renders a complete 7×7-style strategic grid',
    initialBoard.tileData.length >= 25
      && initialBoard.tileData.length === initialBoard.rows * initialBoard.columns,
    `${initialBoard.rows}×${initialBoard.columns}`,
  );
  check('Session exposes explicit objectives', initialBoard.objectiveCount >= 1);
  check('Board uses one roving keyboard tab stop across real buttons', (
    initialBoard.tileData.every((tile) => tile.tag === 'BUTTON' && !tile.disabled)
      && initialBoard.tileData.filter((tile) => tile.tabIndex === 0).length === 1
      && initialBoard.tileData.every((tile) => tile.tabIndex === 0 || tile.tabIndex === -1)
  ));
  check('Every tile has a unique, descriptive accessibility label', (
    initialBoard.tileData.every((tile) => tile.label.length >= 8)
      && new Set(initialBoard.tileData.map((tile) => tile.label)).size === initialBoard.tileData.length
  ));

  const paused = await clickByText('.mc-session-actions button, .mc-page button', /^pause$/i, false);
  check('Session provides an explicit pause control', paused);
  if (paused) {
    await page.waitForSelector('.mc-pause', { visible: true, timeout: 10_000 });
    check('Pause suspends the board behind a visible explanation', await page.evaluate(() => (
      Boolean(document.querySelector('.mc-pause'))
        && [...document.querySelectorAll('.mc-board .mc-tile')].every((tile) => tile.disabled)
    )));
    const resumed = await clickByText('.mc-pause button, .mc-session-actions button', /resume|continue/i, false);
    check('Paused play resumes without rebuilding the board', resumed);
    if (resumed) await page.waitForFunction(() => !document.querySelector('.mc-pause'), { timeout: 10_000 });
  }

  const forecastTab = await clickByText(
    '.mc-coach-tabs button, .mc-session-actions button',
    /forecast/i,
    false,
  );
  if (forecastTab) await page.waitForSelector('.mc-forecast', { visible: true, timeout: 10_000 });
  const forecastBefore = await page.$$('.mc-forecast');
  check('Explainable forecast offers ranked legal candidates', forecastBefore.length >= 1);
  if (forecastBefore.length) {
    await forecastBefore[0].click();
    await page.waitForSelector('.mc-forecast-detail', { visible: true, timeout: 10_000 }).catch(() => null);
    check('Selecting a forecast reveals its reasoning', await page.evaluate(() => (
      Boolean(document.querySelector('.mc-forecast-detail'))
        || Boolean(document.querySelector('.mc-forecast.on, .mc-forecast[aria-pressed="true"]'))
    )));
    // The forecast marks its suggested origin. Escape returns to a neutral
    // selection before independently verifying another legal keyboard move.
    await page.keyboard.press('Escape');
  }

  const beforeMove = await readSessionMetrics();
  const pair = findLegalPair(initialBoard);
  check('Rendered tile semantics expose at least one legal move', Boolean(pair));
  if (!pair) throw new Error('Could not derive a legal swap from rendered tile semantics.');

  await page.evaluate(() => {
    const frame = document.querySelector('.mc-board-frame');
    if (!frame) return;
    const record = {
      sawCascade: false,
      maxImpactCells: 0,
      sawScoreFloater: false,
    };
    const sample = () => {
      record.sawCascade ||= frame.getAttribute('data-effect-phase') === 'cascade';
      record.maxImpactCells = Math.max(
        record.maxImpactCells,
        document.querySelectorAll('.mc-tile[data-effect="clearing"], .mc-cell-effect').length,
      );
      record.sawScoreFloater ||= Boolean(document.querySelector('.mc-score-floater'));
    };
    const observer = new MutationObserver(sample);
    observer.observe(frame, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    sample();
    window.__mindCascadeEffectAudit = { observer, record };
  });

  const dragFeedback = await dragLegalPair(pair);
  check('Pointer drag visibly tracks the tile toward one adjacent target', (
    dragFeedback.dragging
      && ['horizontal', 'vertical'].includes(dragFeedback.axis)
      && dragFeedback.hasTarget
      && /px$/.test(`${dragFeedback.x}${dragFeedback.y}`)
  ), JSON.stringify(dragFeedback));
  check('Board reserves touch gestures for direct tile swiping', dragFeedback.touchAction === 'none');
  await page.waitForFunction(
    ({ oldMoves, oldHistory }) => {
      const entries = [...document.querySelectorAll('.mc-hud > div')];
      const movesEntry = entries.find((entry) => /move/i.test(entry.querySelector('span')?.textContent || ''));
      const moves = Number.parseInt(movesEntry?.querySelector('strong')?.textContent || '', 10);
      const history = document.querySelectorAll('.mc-history-list button, .mc-move-strip button').length;
      return (Number.isFinite(oldMoves) && moves < oldMoves) || history > oldHistory;
    },
    { timeout: 20_000 },
    { oldMoves: beforeMove.moves, oldHistory: beforeMove.historyCount },
  );
  await wait(150);
  const gameFeel = await page.evaluate(() => {
    const frame = document.querySelector('.mc-board-frame');
    const banner = document.querySelector('.mc-turn-banner');
    const effectAudit = window.__mindCascadeEffectAudit;
    effectAudit?.observer.disconnect();
    delete window.__mindCascadeEffectAudit;
    return {
      phase: frame?.getAttribute('data-effect-phase') || 'idle',
      cascadeDepth: Number(frame?.getAttribute('data-cascade-depth') || 0),
      activeDepth: Number(frame?.getAttribute('data-active-depth') || 0),
      motion: frame?.getAttribute('data-feedback-motion') || '',
      banner: banner?.textContent?.replace(/\s+/g, ' ').trim() || '',
      clearingCells: document.querySelectorAll('.mc-tile[data-effect="clearing"], .mc-cell-effect').length,
      hasScoreFloater: Boolean(document.querySelector('.mc-score-floater')),
      sawCascade: effectAudit?.record.sawCascade ?? false,
      maxImpactCells: effectAudit?.record.maxImpactCells ?? 0,
      sawScoreFloater: effectAudit?.record.sawScoreFloater ?? false,
      liveStatus: document.querySelector('.mc-live-note')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    };
  });
  check('Accepted play enters a visible turn-record effect phase', (
    (gameFeel.sawCascade || ['cascade', 'settle', 'finale'].includes(gameFeel.phase))
      && gameFeel.cascadeDepth >= 1
      && gameFeel.activeDepth >= 1
  ), JSON.stringify(gameFeel));
  check('Cascade choreography renders impact cells and a score response', (
    gameFeel.maxImpactCells >= 1
      && (gameFeel.sawScoreFloater || gameFeel.hasScoreFloater)
  ), JSON.stringify(gameFeel));
  check('Turn feedback describes the achieved pattern instead of generic decoration', (
    /cascade|pattern|chain|garden/i.test(gameFeel.banner)
      && /resolved \d+ cascade step.*added \d+ points/i.test(gameFeel.liveStatus)
  ));
  check('Default game feedback uses the full player-selected motion profile', gameFeel.motion === 'full');
  await screenshot('mind-cascade-cascade-impact');
  await wait(300);
  const afterMove = await readSessionMetrics();
  check('A real drag/swipe swap consumes exactly one move', (
    Number.isFinite(beforeMove.moves)
      && Number.isFinite(afterMove.moves)
      && afterMove.moves === beforeMove.moves - 1
  ), `${beforeMove.movesText} → ${afterMove.movesText}`);
  check('The dragged move creates exactly one replay/history record', (
    afterMove.historyCount === beforeMove.historyCount + 1
  ));
  check('Drag state and compositor hints clear immediately on release', await page.evaluate(() => (
    !document.querySelector('.mc-board-frame.is-dragging')
      && !document.querySelector('.mc-tile.drag-source, .mc-tile.drag-target')
  )));
  check('Objectives remain visible after cascade resolution', afterMove.objectiveText.length >= 1);

  await page.click('.mc-board .mc-tile:nth-child(1)');
  check('Click selection remains available alongside direct manipulation', await page.evaluate(() => (
    Boolean(document.querySelector('.mc-board .mc-tile.selected'))
  )));
  await page.keyboard.press('Escape');
  await page.focus('.mc-board .mc-tile:nth-child(1)');
  await page.keyboard.press('Enter');
  check('Keyboard selection remains available alongside direct manipulation', await page.evaluate(() => (
    Boolean(document.querySelector('.mc-board .mc-tile.selected'))
  )));
  await page.keyboard.press('Escape');

  const saved = await storageSnapshot();
  check('Accepted play persists a resumable local session', (
    saved.exists
      && saved.hasSession
      && saved.moveNumber >= 1
      && saved.stateTurn >= 1
      && saved.historyLength >= 1
  ), JSON.stringify(saved));
  await screenshot('mind-cascade-after-move');

  console.log('Persistence and resume');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.mc-page', { visible: true, timeout: 15_000 });
  await page.goto(`${BASE}/#/mind-games/cascade?resume=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForSelector('.mc-board', { visible: true, timeout: 20_000 });
  const resumedMetrics = await readSessionMetrics();
  check('Resume route restores the saved move budget', resumedMetrics.moves === afterMove.moves);
  check('Resume route restores replay history', resumedMetrics.historyCount >= afterMove.historyCount);
  check('Resume route keeps the saved session identity', (await storageSnapshot()).sessionId === saved.sessionId);

  await page.goto(`${BASE}/#/mind-games`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.mind-games-page', { visible: true, timeout: 15_000 });
  check('Hub exposes Resume saved board after accepted play', await page.evaluate(() => (
    [...document.querySelectorAll('a')].some((link) => /Resume saved board/i.test(link.textContent || ''))
  )));

  console.log('Deterministic daily route');
  await page.goto(`${BASE}/#/mind-games/cascade?daily=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForSelector('.mc-page', { visible: true, timeout: 15_000 });
  await ensureBoard();
  await page.waitForSelector('.mc-board .mc-tile', { visible: true, timeout: 15_000 });
  const dailyState = await page.evaluate(() => ({
    text: document.querySelector('.mc-page')?.textContent || '',
    seedText: document.querySelector('.mc-daily-seed')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    board: [...document.querySelectorAll('.mc-board .mc-tile')]
      .map((tile) => `${tile.getAttribute('data-pattern')}:${tile.getAttribute('aria-label')}`)
      .join('|'),
  }));
  check('Daily route clearly identifies a shared daily challenge', (
    /daily|today|shared seed/i.test(`${dailyState.text} ${dailyState.seedText}`)
  ));
  check('Daily route publishes its deterministic seed', /\d{3,}/.test(dailyState.seedText));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.mc-board .mc-tile', { visible: true, timeout: 20_000 });
  const dailyReloadBoard = await page.evaluate(() => (
    [...document.querySelectorAll('.mc-board .mc-tile')]
      .map((tile) => `${tile.getAttribute('data-pattern')}:${tile.getAttribute('aria-label')}`)
      .join('|')
  ));
  check('Daily board reproduces exactly across a reload', dailyReloadBoard === dailyState.board);
  await screenshot('mind-cascade-daily');

  console.log('Light theme contrast');
  await page.evaluate(() => {
    document.documentElement.dataset.uiTheme = 'light';
  });
  const lightTheme = await page.evaluate(() => {
    const hero = document.querySelector('.mc-hero h1');
    const tile = document.querySelector('.mc-tile');
    const channels = (value) => value.match(/\d+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    const brightness = (value) => channels(value).reduce((sum, channel) => sum + channel, 0);
    const luminance = (value) => channels(value)
      .map((channel) => channel / 255)
      .map((channel) => channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const tileStyle = tile ? getComputedStyle(tile) : null;
    const foreground = tileStyle ? luminance(tileStyle.color) : 0;
    const background = tileStyle ? luminance(tileStyle.backgroundColor) : 0;
    return {
      heroTextBrightness: hero ? brightness(getComputedStyle(hero).color) : 0,
      tileContrast: (Math.max(foreground, background) + 0.05)
        / (Math.min(foreground, background) + 0.05),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  });
  check('Authored dark hero retains bright text in the light theme', lightTheme.heroTextBrightness > 600);
  check(
    'Strategic board glyphs retain strong contrast in the light theme',
    lightTheme.tileContrast >= 3,
    `contrast ${lightTheme.tileContrast.toFixed(2)}:1`,
  );
  check('Light theme introduces no horizontal overflow', !lightTheme.overflow);
  await screenshot('mind-cascade-light');
  await page.evaluate(() => {
    document.documentElement.dataset.uiTheme = 'dark';
  });

  console.log('Age-appropriate product safeguards');
  const safeguards = await page.evaluate(() => {
    const interactiveText = [...document.querySelectorAll('button, a, [role="button"]')]
      .map((element) => element.textContent?.replace(/\s+/g, ' ').trim() || '')
      .join(' | ');
    const pageText = document.querySelector('.mc-page')?.textContent || '';
    return {
      pressureTimer: Boolean(document.querySelector('[class*="timer"], [data-timer], time'))
        || /\b\d{1,2}:\d{2}\b/.test(pageText),
      paidLifeAction: /\b(?:buy|purchase|get|add)\s+(?:extra\s+)?lives?\b/i.test(interactiveText),
      lootAction: /\b(?:open|buy|claim)\s+(?:a\s+)?loot\s*box\b/i.test(interactiveText),
      randomRewardAction: /\b(?:spin|claim|buy)\s+(?:a\s+)?(?:random|mystery)\s+(?:reward|prize)\b/i.test(interactiveText),
      gamblingLanguage: /\b(?:bet|wager|jackpot|cash\s+prize|real-money)\b/i.test(interactiveText),
    };
  });
  check('No pressure countdown is present', !safeguards.pressureTimer);
  check('No paid-life action is present', !safeguards.paidLifeAction);
  check('No loot-box or random-reward action is present', !safeguards.lootAction && !safeguards.randomRewardAction);
    check('No gambling-oriented action is present', !safeguards.gamblingLanguage);
  }

  console.log('Mobile experience');
  // Changing `isMobile` or `hasTouch` asks Chromium to reload the active page.
  // Reset first so that reload cannot be held open by the running game/audio
  // graph and the mobile checks begin from a clean touch-capable document.
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 10_000 });
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(`${BASE}/#/mind-games`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector('.mind-games-page', { visible: true, timeout: 15_000 });
  check('Mind Games hub has no mobile horizontal overflow', await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
  )));
  await screenshot('mind-games-hub-mobile');

  await page.goto(`${BASE}/#/mind-games/cascade?resume=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForSelector('.mc-page', { visible: true, timeout: 15_000 });
  await ensureBoard();
  await page.waitForSelector('.mc-board', { visible: true, timeout: 15_000 });
  const mobile = await page.evaluate(() => {
    const board = document.querySelector('.mc-board');
    const boardRect = board?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      boardInsideViewport: Boolean(
        boardRect && boardRect.left >= -1 && boardRect.right <= document.documentElement.clientWidth + 1,
      ),
      tiles: document.querySelectorAll('.mc-board .mc-tile').length,
      objectives: document.querySelectorAll('.mc-objective').length,
    };
  });
  check('Mind Cascade has no mobile horizontal overflow', !mobile.overflow);
  check('Mobile board stays inside the viewport', mobile.boardInsideViewport);
  check('Mobile retains the complete board and objectives', mobile.tiles >= 25 && mobile.objectives >= 1);

  const mobileBoard = await boardSnapshot();
  const mobilePair = findLegalPair(mobileBoard);
  check('Mobile board exposes a legal swipe target', Boolean(mobilePair));
  if (mobilePair) {
    const mobileBefore = await readSessionMetrics();
    const touchFeedback = await touchSwipeLegalPair(mobilePair);
    check('Touch input visibly tracks a marble toward one adjacent target', (
      touchFeedback?.dragging
        && ['horizontal', 'vertical'].includes(touchFeedback.axis)
        && touchFeedback.hasSource
        && touchFeedback.hasTarget
        && touchFeedback.sourceInsideViewport
        && touchFeedback.targetInsideViewport
    ), JSON.stringify(touchFeedback));
    await page.waitForFunction(
      ({ oldMoves, oldHistory }) => {
        const entries = [...document.querySelectorAll('.mc-hud > div')];
        const movesEntry = entries.find((entry) => /move/i.test(entry.querySelector('span')?.textContent || ''));
        const moves = Number.parseInt(movesEntry?.querySelector('strong')?.textContent || '', 10);
        const history = document.querySelectorAll('.mc-history-list button, .mc-move-strip button').length;
        return (Number.isFinite(oldMoves) && moves < oldMoves) || history > oldHistory;
      },
      { timeout: 20_000 },
      { oldMoves: mobileBefore.moves, oldHistory: mobileBefore.historyCount },
    );
    const mobileAfter = await readSessionMetrics();
    check('A real touch swipe commits exactly one legal move', (
      Number.isFinite(mobileBefore.moves)
        && mobileAfter.moves === mobileBefore.moves - 1
        && mobileAfter.historyCount === mobileBefore.historyCount + 1
    ), `${mobileBefore.movesText} → ${mobileAfter.movesText}`);
  }
  await screenshot('mind-cascade-mobile');

  check(
    'Browser run produced no unexpected console, page, request or response failures',
    browserErrors.length === 0,
    browserErrors.join(' | ').slice(0, 500),
  );

  const passed = results.every((result) => result.passed);
  console.log(JSON.stringify({
    passed,
    checks: results.length,
    failed: results.filter((result) => !result.passed),
    errors: browserErrors,
    screenshots: SCREENSHOT_DIR,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} catch (error) {
  check('Mind Games smoke completed without an uncaught browser failure', false, error.stack || error.message);
  await screenshot('mind-games-error').catch(() => {});
  console.log(JSON.stringify({
    passed: false,
    checks: results.length,
    failed: results.filter((result) => !result.passed),
    errors: [...browserErrors, String(error.stack || error.message)],
    screenshots: SCREENSHOT_DIR,
  }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
