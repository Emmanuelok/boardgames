import teeko from '../src/games/teeko';

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const empty = () => Array(25).fill(null) as (0 | 1 | null)[];
const S = (b: (0 | 1 | null)[], turn = 0, ply = 0) => teeko.deserialize(JSON.stringify({ board: b, turn, ply }));

// 1. Opening
const s0 = teeko.createInitialState();
ok(s0.board.length === 25 && s0.board.every((x: any) => x === null), 'initial board is 25 empty cells');
ok(teeko.getTurn(s0) === 0, 'Black moves first');
ok(teeko.getLegalMoves(s0, null).length === 25, '25 drop moves at start');
ok(teeko.getLegalMoves(s0, null).every((m) => m.from === undefined), 'opening moves are drops (no from)');

// 2. Drop reduces options
let b = empty(); b[12] = 0;
ok(teeko.getLegalMoves(S(b, 1), null).length === 24, 'after one drop, 24 cells remain to drop');

// 3. Move phase yields slides; corner adjacency (incl. diagonal)
b = empty(); [0, 2, 20, 22].forEach((i) => (b[i] = 0)); [1, 3, 21, 23].forEach((i) => (b[i] = 1));
const sm = S(b, 0, 8);
const mv = teeko.getLegalMoves(sm, null);
ok(mv.length > 0 && mv.every((m) => m.from !== undefined), 'move phase yields slides (with from)');
ok(teeko.getLegalMoves(sm, 0).length === 2, 'corner man a5 has 2 slide targets (down + diagonal)');

// 4. Win detection
b = empty(); [0, 1, 2, 3].forEach((i) => (b[i] = 0)); [10, 11, 12, 13].forEach((i) => (b[i] = 1));
let st = teeko.getStatus(S(b, 1, 8));
ok(st.kind === 'win' && (st as any).winner === 0 && /four/.test((st as any).reason), 'four-in-a-row is a win');
b = empty(); [0, 1, 5, 6].forEach((i) => (b[i] = 1)); [2, 12, 13, 17].forEach((i) => (b[i] = 0));
st = teeko.getStatus(S(b, 0, 8));
ok(st.kind === 'win' && (st as any).winner === 1 && /square/.test((st as any).reason), '2×2 square is a win');
b = empty(); [0, 6, 12, 18].forEach((i) => (b[i] = 0)); [1, 3, 21, 23].forEach((i) => (b[i] = 1));
ok(teeko.getStatus(S(b, 1, 8)).kind === 'win', 'diagonal four is a win');
b = empty(); [0, 2, 12, 24].forEach((i) => (b[i] = 0)); [1, 3, 13, 23].forEach((i) => (b[i] = 1));
ok(teeko.getStatus(S(b, 0, 8)).kind === 'playing', 'scattered position is still playing');

// 5. The interactive tutorial challenge actually wins
const ch = teeko.tutorial.chapters.flatMap((c) => c.steps).find((s) => s.challenge)!;
ok(!!ch?.setup, 'has an interactive challenge with a setup');
const cs = teeko.deserialize(ch.setup!);
const sol = teeko.getLegalMoves(cs, null).find((m) => m.notation === ch.challenge!.solution[0]);
ok(!!sol, `challenge solution ${ch.challenge!.solution[0]} is a legal move`);
const cst = teeko.getStatus(teeko.applyMove(cs, sol!));
ok(cst.kind === 'win' && (cst as any).winner === 0, 'challenge solution wins for Black');

// 6. applyMove correctness
const drop = teeko.getLegalMoves(s0, null).find((m) => m.notation === 'c3')!;
const d = teeko.applyMove(s0, drop);
ok(d.board[12] === 0 && d.turn === 1 && d.ply === 1, 'drop places Black on c3, passes the turn, advances ply');

// 7. AI returns a legal, timely opening move
const t0 = Date.now();
const aiMove = teeko.chooseMove(s0, 'master');
const dt = Date.now() - t0;
ok(!!aiMove && teeko.getLegalMoves(s0, null).some((m) => m.id === aiMove!.id), 'master AI returns a legal opening move');
ok(dt < 2500, `master AI opening is timely (${dt}ms)`);

// 8. A self-play game stays legal and reaches a result
let g = teeko.createInitialState();
let n = 0, illegal = false;
while (teeko.getStatus(g).kind === 'playing' && n < 200) {
  const m = teeko.chooseMove(g, 'medium');
  if (!m) break;
  if (!teeko.getLegalMoves(g, null).some((x) => x.id === m.id)) { illegal = true; break; }
  g = teeko.applyMove(g, m); n++;
}
ok(!illegal, 'AI never plays an illegal move in self-play');
ok(teeko.getStatus(g).kind !== 'playing' || n >= 200, `self-play reaches a result (${n} plies, ${teeko.getStatus(g).kind})`);

console.log(fail === 0 ? '\n✅ TEEKO OK' : `\n❌ ${fail} failure(s)`);
if (fail) process.exit(1);
