/** Tafl (Brandub): rules, capture, king capture/escape, AI, termination, setups. */
import def, { initialState, evaluate } from '../src/games/tafl';
import type { Difficulty } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };
const N = 7;
const sqToIdx = (s: string) => (N - +s[1]) * N + (s.charCodeAt(0) - 97);
function pos(list: [string, number][], turn: 0 | 1, since = 0) {
  const board: (number | null)[] = Array(N * N).fill(null);
  for (const [s, v] of list) board[sqToIdx(s)] = v;
  return { board, turn, since };
}
const notes = (s: any) => def.getLegalMoves(s, null).map((m) => m.notation);
const dests = (s: any, from: string) => def.getLegalMoves(s, sqToIdx(from)).map((m) => m.notation.split('-')[1]);

// ---- Setup ----
const init = initialState();
ok(init.board[sqToIdx('d4')] === 2 && init.board.filter((v) => v === 1).length === 4 && init.board.filter((v) => v === 0).length === 8, 'initial: king on throne, 4 defenders, 8 attackers');
ok(def.getStatus(init).kind === 'playing' && init.turn === 0 && notes(init).length > 0, 'initial: Attackers to move, playing');

// ---- Movement ----
// A soldier may not pass through or land on the throne (d4) or corners.
{
  const s = pos([['b4', 0], ['f1', 2]], 0); // attacker on b4 (row 3), king parked at g1
  const d = dests(s, 'b4');
  ok(d.includes('c4') && !d.includes('d4') && !d.includes('e4'), 'a soldier is blocked by the throne (can reach c4, not d4/e4)');
}
// The king passes through the throne and may land on it.
{
  const s = pos([['b4', 2], ['a1', 0]], 1);
  const d = dests(s, 'b4');
  ok(d.includes('d4') && d.includes('e4'), 'the king may slide through and onto the throne');
}

// ---- Capture a soldier by sandwiching ----
{
  const s = pos([['b5', 0], ['c5', 1], ['g5', 0], ['d4', 2]], 0); // attackers b5 & g5, defender c5
  const m = def.getLegalMoves(s, null).find((x) => x.notation === 'g5-d5')!; // g5 → d5 sandwiches c5
  ok(!!m, 'capturing move g5-d5 is available');
  if (m) ok(def.applyMove(s, m).board[sqToIdx('c5')] === null, 'sandwiched defender on c5 is captured');
}

// ---- King capture (surrounded) → attackers win ----
ok((def.getStatus(pos([['d4', 2], ['d5', 0], ['d3', 0], ['c4', 0], ['e4', 0]], 1)) as any).winner === 0, 'king surrounded on the throne → attackers win');

// ---- King escape to a corner → defenders win ----
{
  const s = pos([['d7', 2], ['d1', 0], ['g4', 0]], 1); // king on d7 with row 7 clear to the corners
  const m = def.getLegalMoves(s, null).find((x) => x.notation === 'd7-a7')!; // king slides to the corner
  ok(!!m && (def.getStatus(def.applyMove(s, m)) as any).winner === 1, 'king reaching a corner → defenders win');
}

ok(JSON.stringify(def.deserialize(def.serialize(init))) === JSON.stringify(init), 'serialize/deserialize roundtrip');

// ---- AI + termination ----
for (const d of ['easy', 'medium', 'hard', 'master'] as Difficulty[]) {
  const t0 = Date.now(); const m = def.chooseMove(init, d); const dt = Date.now() - t0;
  ok(!!m, `chooseMove(${d}) → ${m?.notation} (${dt}ms)`);
}
{
  let s = init, plies = 0, status = def.getStatus(s); const t0 = Date.now();
  while (status.kind === 'playing' && plies < 300) { const m = def.chooseMove(s, 'medium'); if (!m) break; s = def.applyMove(s, m); status = def.getStatus(s); plies++; }
  const res = status.kind === 'win' ? `${def.players[(status as any).winner].name} (${(status as any).reason})` : status.kind === 'draw' ? 'draw' : `capped ${plies}`;
  ok(status.kind === 'win' || status.kind === 'draw', `AI vs AI ends: ${plies} plies → ${res} (${Date.now() - t0}ms)`);
}

// ---- Tutorial setups ----
const cap = pos([['b5', 0], ['c5', 1], ['g5', 0], ['f1', 2], ['a1', 0]], 0);
ok(notes(cap).includes('g5-d5'), 'CAP illustration: g5-d5 capture available');
console.log(`     __CAP_SETUP__ = ${def.serialize(cap)}`);

const esc = pos([['d7', 2], ['g1', 0], ['a1', 0], ['d3', 1]], 1);
const wins = def.getLegalMoves(esc, null).filter((m) => (def.getStatus(def.applyMove(esc, m)) as any).winner === 1);
ok(def.getStatus(esc).kind === 'playing' && wins.length > 0, `ESC puzzle: winning king moves = ${wins.map((m) => m.notation).join(', ')}`);
console.log(`     __ESC_SETUP__ = ${def.serialize(esc)}`);
console.log(`     __ESC_SOL__ = ${JSON.stringify(wins.map((m) => m.notation))}`);
void evaluate;

console.log(fail === 0 ? '\n✅ TAFL OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
