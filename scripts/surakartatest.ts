/** Surakarta: loop-capture correctness, the safe centre, AI, termination. */
import { initialState, legalMoves, applyMove, winnerOf, captureRay, chooseMove, type SkState } from '../src/games/surakarta/logic';
import type { Player } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const idx = (r: number, c: number) => r * 6 + c;
const empty = (): (Player | null)[] => Array(36).fill(null);
const st = (points: (Player | null)[], turn: Player = 0): SkState => ({ points, turn, sinceCapture: 0 });

const init = initialState();
ok(init.points.filter((v) => v === 0).length === 12 && init.points.filter((v) => v === 1).length === 12, 'starts 12 v 12 on the two nearest ranks');
ok(init.points.slice(12, 24).every((v) => v === null), 'the two central ranks start empty');

// 1) Loop capture around the TR outer corner: P0 a6 (0,2) rides row0→col5 and takes an enemy on f3 (3,5).
{
  const b = empty(); b[idx(0, 2)] = 0; b[idx(3, 5)] = 1;
  const cap = captureRay(b, idx(0, 2), 'R');
  ok(!!cap && cap.target === idx(3, 5), 'outer-loop capture: row 0 sweeps around the TR loop down column 5');
}
// 2) A straight-line enemy with NO loop between is NOT capturable.
{
  const b = empty(); b[idx(0, 2)] = 0; b[idx(0, 4)] = 1; // same row, no loop ridden before reaching it
  ok(captureRay(b, idx(0, 2), 'R') === null, 'a piece reached before any loop cannot be captured');
}
// 3) The four central points can neither capture (no loop on rows/cols 2,3)…
{
  const b = empty(); b[idx(2, 2)] = 0; b[idx(2, 5)] = 1; b[idx(5, 2)] = 1;
  ok((['U', 'D', 'L', 'R'] as const).every((d) => captureRay(b, idx(2, 2), d) === null), 'a central piece (c4) has no capture in any direction');
}
// 4) …nor be captured: no ray rides through a central point.
{
  const b = empty(); b[idx(0, 0)] = 0; b[idx(2, 2)] = 1;
  ok((['U', 'D', 'L', 'R'] as const).every((d) => { const r = captureRay(b, idx(0, 0), d); return !r || r.target !== idx(2, 2); }), 'no capture ray ever lands on the safe centre');
}
// 5) A friendly piece on the track blocks the capture.
{
  const b = empty(); b[idx(0, 2)] = 0; b[idx(2, 5)] = 0; b[idx(3, 5)] = 1; // friendly on c4? (2,5) is on the track before (3,5)
  ok(captureRay(b, idx(0, 2), 'R') === null, 'a friendly piece on the loop track blocks the capture');
}
// 6) A lone piece circling the whole board captures nothing.
{
  const b = empty(); b[idx(0, 2)] = 0;
  ok(captureRay(b, idx(0, 2), 'R') === null, 'a full circuit with no enemy captures nothing');
}
// 7) Inner-loop capture: P0 b5 (1,2) rides row1→col4 (TR inner) and takes an enemy on e3 (3,4).
{
  const b = empty(); b[idx(1, 2)] = 0; b[idx(3, 4)] = 1;
  const cap = captureRay(b, idx(1, 2), 'R');
  ok(!!cap && cap.target === idx(3, 4), 'inner-loop capture: row 1 sweeps around the TR inner loop down column 4');
}
// 8) applyMove performs the capture (mover lands on the target; victim removed).
{
  const b = empty(); b[idx(0, 2)] = 0; b[idx(3, 5)] = 1;
  const m = legalMoves(st(b, 0)).find((mv) => mv.capture && mv.to === idx(3, 5))!;
  ok(!!m, 'the capture is offered as a legal move');
  const after = applyMove(st(b, 0), m);
  ok(after.points[idx(3, 5)] === 0 && after.points[idx(0, 2)] === null && after.sinceCapture === 0, 'capture moves the piece onto the target and clears the source');
}
// 9) Captures are NOT forced — simple moves coexist.
{
  const b = empty(); b[idx(0, 2)] = 0; b[idx(3, 5)] = 1;
  const ms = legalMoves(st(b, 0));
  ok(ms.some((m) => m.capture) && ms.some((m) => !m.capture), 'both captures and simple moves are legal (capture is optional)');
}

// Win / draw.
ok(winnerOf(st((() => { const b = empty(); b[0] = 0; return b; })(), 1)) === 0, 'a side with no pieces loses');
ok(winnerOf({ points: (() => { const b = empty(); b[0] = 0; b[35] = 1; return b; })(), turn: 0, sinceCapture: 40 }) === 'draw', '40 captureless moves is a draw');

// AI + determinism + speed.
for (const d of ['easy', 'medium', 'hard', 'master'] as const) ok(!!chooseMove(init, d), `chooseMove(${d}) → ${chooseMove(init, d)?.notation}`);
ok(chooseMove(init, 'master')?.id === chooseMove(init, 'master')?.id, 'chooseMove is deterministic');
{ const t0 = Date.now(); chooseMove(init, 'master'); const ms = Date.now() - t0; ok(ms < 3500, `master opening move in ${ms}ms (<3500)`); }

// Termination: an AI-vs-AI game ends (capture-out or the no-capture draw rule).
{
  let s: SkState = init, plies = 0; const t0 = Date.now();
  while (winnerOf(s) === null && plies < 400) { const m = chooseMove(s, 'medium'); if (!m) break; s = applyMove(s, m); plies++; }
  ok(winnerOf(s) !== null && plies < 400, `AI vs AI ends in ${plies} plies → ${winnerOf(s)} (${Date.now() - t0}ms)`);
}

console.log(fail === 0 ? '\n✅ SURAKARTA OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
