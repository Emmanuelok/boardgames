/** Squava: four-wins / three-loses rule, AI, termination, trainer puzzle. */
import def, { createInitialState, legalMoves, applyMove, winnerOf, type SquavaState } from '../src/games/squava';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const st = (board: (0 | 1 | null)[], turn: 0 | 1): SquavaState => ({ board, turn });
const empty = (): (0 | 1 | null)[] => Array(25).fill(null);

const init = createInitialState();
ok(init.board.every((v) => v === null) && init.turn === 0, 'initial: empty 5×5, you first');
ok(legalMoves(init).length === 25, 'opening: 25 placements');

// Three in a row by the mover → the mover loses (other player wins).
{
  const b = empty(); b[5] = 0; b[6] = 0; b[7] = 0; // ✕ ✕ ✕ across row 3 (indices 5,6,7)
  // mover was player 0 (turn now 1). Player 0 made a bare three → player 0 loses → winner 1.
  ok(winnerOf(st(b, 1)) === 1, 'a bare three-in-a-row loses for the player who made it');
}

// Four in a row by the mover → the mover wins (takes precedence over the three within it).
{
  const b = empty(); b[5] = 0; b[6] = 0; b[7] = 0; b[8] = 0; // four across
  ok(winnerOf(st(b, 1)) === 0, 'four-in-a-row wins for the player who made it');
}

// The gap shape ✕ ✕ _ ✕ is SAFE (max run 2), and filling the gap wins.
{
  const gap = empty(); gap[5] = 0; gap[6] = 0; gap[8] = 0; // ✕ ✕ _ ✕
  ok(winnerOf(st(gap, 1)) === null, 'a gapped three (✕ ✕ _ ✕) is safe — not a losing three');
  const filled = applyMove(st(gap, 0), { id: 'p7', to: 7, notation: '' }); // fill the gap → four
  ok(winnerOf(filled) === 0, 'filling the gap completes four and wins');
}

// A diagonal three also loses.
{
  const b = empty(); b[0] = 1; b[6] = 1; b[12] = 1; // diagonal ◯ ◯ ◯
  ok(winnerOf(st(b, 0)) === 0, 'a diagonal three loses for its maker (player 1) → player 0 wins');
}

// AI at every difficulty, deterministic, and the wide opening stays fast.
for (const d of ['easy', 'medium', 'hard', 'master'] as const) ok(!!def.chooseMove!(init, d), `chooseMove(${d}) → ${def.chooseMove!(init, d)?.notation}`);
ok(def.chooseMove!(init, 'master')?.id === def.chooseMove!(init, 'master')?.id, 'chooseMove is deterministic');
{ const t0 = Date.now(); def.chooseMove!(init, 'master'); const ms = Date.now() - t0; ok(ms < 3000, `master opening move in ${ms}ms (<3000)`); }

// A clear winning move is found: from ✕ ✕ _ ✕, the engine fills the gap.
{
  const gap = empty(); gap[5] = 0; gap[6] = 0; gap[8] = 0;
  const m = def.chooseMove!(st(gap, 0), 'hard');
  ok(m?.to === 7, 'engine completes the winning four through the gap');
}

// Termination: every move fills a cell, so a game ends in ≤25 plies, decisively or drawn.
{
  let s: SquavaState = init, plies = 0; const t0 = Date.now();
  while (winnerOf(s) === null && plies < 30) { const m = def.chooseMove!(s, 'medium'); if (!m) break; s = applyMove(s, m); plies++; }
  const w = winnerOf(s);
  ok(w !== null && plies <= 25, `AI vs AI ends in ${plies} plies (≤25) → ${w === 'draw' ? 'draw' : w === 0 ? 'You' : 'Owl'} (${Date.now() - t0}ms)`);
}

// Trainer puzzle: deserialize, only-solution is the gap fill, no leftover placeholder.
{
  const step = def.tutorial.chapters.flatMap((c) => c.steps).find((s) => !!s.challenge)!;
  ok(!JSON.stringify(def.tutorial).includes('__'), 'no placeholder remains in the tutorial');
  const s = def.deserialize(step.setup!);
  const m = def.chooseMove!(s, 'master');
  ok(!!m && `✕ ${'abcde'[m.to % 5]}${5 - Math.floor(m.to / 5)}` === step.challenge!.solution[0], 'trainer position is solved by the puzzle solution');
}

ok(def.serialize(def.deserialize(def.serialize(init))) === def.serialize(init), 'serialize/deserialize roundtrip');

console.log(fail === 0 ? '\n✅ SQUAVA OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
