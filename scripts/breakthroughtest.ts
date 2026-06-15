/** Breakthrough: rules, AI, and tutorial-challenge verification. Also prints the
 *  serialized challenge setups so the tutorial uses verified positions. */
import def, { initialState, evaluate } from '../src/games/breakthrough';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

type P = 0 | 1 | null;
const N = 8;
const sqToIdx = (s: string) => { const c = s.charCodeAt(0) - 97; const rank = +s[1]; return (N - rank) * N + c; };
function pos(pieces: [string, 0 | 1][], turn: 0 | 1) {
  const board: P[] = Array(64).fill(null);
  for (const [s, p] of pieces) board[sqToIdx(s)] = p;
  return { board, turn };
}
const legalNot = (s: any) => def.getLegalMoves(s, null).map((m) => m.notation);

// ---- Rules ----
const init = initialState();
ok(init.board.filter((v) => v === 0).length === 16 && init.board.filter((v) => v === 1).length === 16, 'initial: 16 pawns each');
ok(def.getStatus(init).kind === 'playing' && init.turn === 0, 'initial: White to move, playing');
ok(evaluate(init) === 0, 'initial position evaluates to 0 (symmetric)');

// A lone White pawn on d4 (row4,col3): straight d4-d5, diagonals c5/e5 (empty) — 3 moves.
const lone = pos([['d4', 0]], 0);
ok(legalNot(lone).sort().join(',') === ['d4-d5', 'd4-c5', 'd4-e5'].sort().join(','), 'pawn: 1 straight + 2 diagonal moves on open board');

// Blocked straight + diagonal captures only.
const cap = pos([['b7', 0], ['a8', 1], ['b8', 1], ['c8', 1]], 0);
ok(!legalNot(cap).includes('b7-b8'), 'cannot move straight onto an occupied square');
ok(legalNot(cap).includes('b7xa8') && legalNot(cap).includes('b7xc8'), 'captures diagonally onto enemy pawns');
ok(!def.getLegalMoves(cap, null).some((m) => m.notation === 'b7-b8'), 'never captures straight ahead');

// Win by reaching the home rank.
const winState = def.applyMove(pos([['a7', 0], ['h2', 1]], 0), def.getLegalMoves(pos([['a7', 0], ['h2', 1]], 0), null).find((m) => m.notation === 'a7-a8')!);
ok(def.getStatus(winState).kind === 'win' && (def.getStatus(winState) as any).winner === 0, 'reaching the home rank wins');

// serialize roundtrip
const round = def.deserialize(def.serialize(init));
ok(JSON.stringify(round) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// ---- AI ----
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now();
  const m = def.chooseMove(init, d);
  const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) returns a move (${m?.notation}, ${dt}ms)`);
}

// AI vs AI to completion
{
  let s = init; let plies = 0; let status = def.getStatus(s);
  const t0 = Date.now();
  while (status.kind === 'playing' && plies < 400) {
    const m = def.chooseMove(s, 'medium');
    if (!m) break;
    s = def.applyMove(s, m); status = def.getStatus(s); plies++;
  }
  const res = status.kind === 'win' ? `${def.players[(status as any).winner].name} (${(status as any).reason})` : `capped ${plies}`;
  ok(status.kind === 'win', `AI vs AI completes: ${plies} plies → ${res} (${Date.now() - t0}ms)`);
}

// ---- Tutorial challenges: build, verify, and print serialized setups ----
function verifyChallenge(name: string, pieces: [string, 0 | 1][], turn: 0 | 1, solutions: string[], mustWin: boolean) {
  const s = pos(pieces, turn);
  const playing = def.getStatus(s).kind === 'playing';
  const legal = legalNot(s);
  const allLegal = solutions.every((sol) => legal.includes(sol));
  let winsOk = true;
  if (mustWin) {
    for (const sol of solutions) {
      const mv = def.getLegalMoves(s, null).find((m) => m.notation === sol)!;
      const after = def.applyMove(s, mv);
      if (!(def.getStatus(after).kind === 'win' && (def.getStatus(after) as any).winner === turn)) winsOk = false;
    }
  }
  ok(playing && allLegal && winsOk, `challenge "${name}": playing=${playing} legal=${allLegal} wins=${winsOk}`);
  console.log(`     setup: ${JSON.stringify(s)}`);
}

verifyChallenge('break through', [['a7', 0], ['h2', 1]], 0, ['a7-a8'], true);
verifyChallenge('capture in', [['b7', 0], ['a8', 1], ['b8', 1], ['c8', 1]], 0, ['b7xa8', 'b7xc8'], true);
verifyChallenge('cut the runner', [['b2', 1], ['a1', 0], ['c1', 0]], 0, ['a1xb2', 'c1xb2'], false);

// ---- Illustrative (non-challenge) setups: print verified, valid positions ----
console.log('  -- illustrative setups --');
console.log(`     moving (Wd4): ${def.serialize(pos([['d4', 0]], 0))}`);
const capIllus = pos([['d4', 0], ['d5', 1], ['c5', 1], ['e5', 1]], 0);
ok(!legalNot(capIllus).includes('d4-d5') && legalNot(capIllus).includes('d4xc5') && legalNot(capIllus).includes('d4xe5'), 'capturing illus: straight blocked, diagonals capture');
console.log(`     capturing: ${def.serialize(capIllus)}`);
console.log(`     phalanx (Wc3,d3,e3): ${def.serialize(pos([['c3', 0], ['d3', 0], ['e3', 0]], 0))}`);

// ---- Validate EVERY tutorial setup parses to a clean 0/1/null board of 64 ----
let setups = 0;
for (const ch of def.tutorial.chapters) {
  for (const st of ch.steps) {
    if (!st.setup) continue;
    setups++;
    try {
      const s = def.deserialize(st.setup);
      const clean = Array.isArray(s.board) && s.board.length === 64 && s.board.every((v: any) => v === null || v === 0 || v === 1);
      const cells = def.getBoardView(s).cells.length;
      ok(clean && cells === 64, `tutorial setup "${st.title}" is a valid 64-cell board`);
    } catch (e) {
      ok(false, `tutorial setup "${st.title}" failed to parse: ${(e as Error).message}`);
    }
  }
}
console.log(`  (${setups} tutorial setups checked)`);

console.log(fail === 0 ? '\n✅ BREAKTHROUGH OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
