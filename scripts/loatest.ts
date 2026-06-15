/** Lines of Action: rules, AI, and tutorial-setup generation/verification. */
import def, { initialState, evaluate } from '../src/games/linesOfAction';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const N = 8;
type P = 0 | 1 | null;
const sqToIdx = (s: string) => (N - +s[1]) * N + (s.charCodeAt(0) - 97);
function pos(list: [string, 0 | 1][], turn: 0 | 1) {
  const board: P[] = Array(64).fill(null);
  for (const [s, p] of list) board[sqToIdx(s)] = p;
  return { board, turn };
}
const notes = (s: any) => def.getLegalMoves(s, null).map((m) => m.notation);
const groups = (board: P[], p: 0 | 1) => { // 8-connected component count (mirror of internal)
  const cells = new Set<number>(); board.forEach((v, i) => v === p && cells.add(i));
  const seen = new Set<number>(); let g = 0;
  for (const st of cells) { if (seen.has(st)) continue; g++; const stk = [st]; seen.add(st);
    while (stk.length) { const cur = stk.pop()!; const r = cur >> 3, c = cur & 7;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc; if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        const ni = nr * 8 + nc; if (cells.has(ni) && !seen.has(ni)) { seen.add(ni); stk.push(ni); } } } }
  return g;
};

// ---- Rules ----
const init = initialState();
ok(init.board.filter((v) => v === 0).length === 12 && init.board.filter((v) => v === 1).length === 12, 'initial: 12 men each');
ok([0, 7, 56, 63].every((i) => init.board[i] === null), 'initial: corners empty');
ok(def.getStatus(init).kind === 'playing' && init.turn === 0, 'initial: Black to move, playing');

// A man whose lines hold only itself moves exactly 1 (8 ways). Use a far second
// man (b8) so Black is two groups and the position isn't already won.
const oneStep = notes(pos([['d4', 0], ['b8', 0]], 0)).filter((n) => n.startsWith('d4'));
ok(oneStep.length === 8, `move length 1 on empty lines → 8 one-step moves (${oneStep.length})`);

// Three men on rank 4 (with gaps, so not yet connected) → a horizontal move is 3.
ok(notes(pos([['a4', 0], ['c4', 0], ['e4', 0]], 0)).includes('e4-h4'), 'move length equals men on the line (3 → e4-h4)');

// Cannot leap an enemy man in the path.
ok(!notes(pos([['d4', 0], ['f4', 1], ['h4', 0]], 0)).includes('d4-g4'), 'cannot jump over an enemy man');

// May leap your OWN man (b4 jumps c4 to land on e4).
ok(notes(pos([['b4', 0], ['c4', 0], ['f4', 0]], 0)).includes('b4-e4'), 'may leap your own man');

// Capture by landing on an enemy (both sides split into two groups; d4 takes g4
// at distance 3 along the rank). h1 keeps White from being a lone connected man.
ok(notes(pos([['a4', 0], ['d4', 0], ['g4', 1], ['h1', 1]], 0)).includes('d4xg4'), 'captures by landing on an enemy');

// Connection wins; a single man counts as connected.
const connectedBlack = pos([['c4', 0], ['d4', 0], ['c5', 0], ['d5', 0]], 1); // Black just moved (turn=1)
ok(def.getStatus(connectedBlack).kind === 'win' && (def.getStatus(connectedBlack) as any).winner === 0, 'all men in one group wins');
const loneWins = pos([['d4', 1], ['a1', 0]], 0); // Black to move but White (just moved) has 1 man → connected
ok((def.getStatus(loneWins) as any).winner === 1, 'a lone man counts as connected (over-capture loses)');

// serialize roundtrip
ok(JSON.stringify(def.deserialize(def.serialize(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// ---- AI ----
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now(); const m = def.chooseMove(init, d); const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) → ${m?.notation} (${dt}ms)`);
}
{
  let s = init, plies = 0, status = def.getStatus(s); const t0 = Date.now();
  while (status.kind === 'playing' && plies < 300) { const m = def.chooseMove(s, 'medium'); if (!m) break; s = def.applyMove(s, m); status = def.getStatus(s); plies++; }
  const res = status.kind === 'win' ? `${def.players[(status as any).winner].name} (${(status as any).reason})` : `capped ${plies}`;
  ok(status.kind === 'win', `AI vs AI completes: ${plies} plies → ${res} (${Date.now() - t0}ms)`);
}

// ---- Tutorial setups (generate + verify, then print for pasting) ----
// WIN illustration: Black connected, White in ≥2 groups, "Black just moved".
const winSetup = pos([['c4', 0], ['d4', 0], ['e4', 0], ['f4', 0], ['c5', 0], ['d5', 0], ['e5', 0], ['f5', 0], ['a1', 1], ['a2', 1], ['h8', 1], ['h7', 1]], 1);
ok(def.getStatus(winSetup).kind === 'win' && (def.getStatus(winSetup) as any).winner === 0 && groups(winSetup.board as P[], 1) >= 2, 'WIN illustration: Black connected, White split');
console.log(`     __WIN_SETUP__ = ${def.serialize(winSetup)}`);

// C1 puzzle: Black to move, one straggler joins the block to win.
const c1 = pos([['a4', 0], ['c4', 0], ['d4', 0], ['e4', 0], ['d5', 0], ['e5', 0], ['f1', 1], ['g1', 1], ['h8', 1]], 0);
const playing = def.getStatus(c1).kind === 'playing';
const winning = def.getLegalMoves(c1, null).filter((m) => { const w = def.getStatus(def.applyMove(c1, m)); return w.kind === 'win' && (w as any).winner === 0; });
ok(playing && winning.length > 0, `C1 puzzle: playing=${playing}, winning moves = ${winning.map((m) => m.notation).join(', ')}`);
console.log(`     __C1_SETUP__ = ${def.serialize(c1)}`);
console.log(`     __C1_SOL__ = ${JSON.stringify(winning.map((m) => m.notation))}`);

console.log(fail === 0 ? '\n✅ LINES OF ACTION OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
