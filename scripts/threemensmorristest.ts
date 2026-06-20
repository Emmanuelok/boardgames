import tmm from '../src/games/threemensmorris';

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const empty = () => Array(9).fill(null) as (0 | 1 | null)[];
const S = (b: (0 | 1 | null)[], turn = 0, ply = 0) => tmm.deserialize(JSON.stringify({ board: b, turn, ply }));

// 1. Opening (placement)
const s0 = tmm.createInitialState();
ok(s0.board.length === 9 && s0.board.every((x: any) => x === null), 'initial board is 9 empty points');
ok(tmm.getTurn(s0) === 0, 'Black places first');
ok(tmm.getLegalMoves(s0, null).length === 9 && tmm.getLegalMoves(s0, null).every((m) => m.from === undefined), '9 placement moves at start (drops)');
ok(tmm.getLegalMoves(S(empty().map((_, i) => (i === 4 ? 0 : null)) as any, 1), null).length === 8, 'after one placement, 8 points remain');

// 2. Placement win
let b = empty(); [0, 1].forEach((i) => (b[i] = 0)); [3, 4].forEach((i) => (b[i] = 1));
const pw = tmm.getLegalMoves(S(b, 0, 4), null).find((m) => m.notation === 'c3');
ok(!!pw, 'c3 is a legal placement');
ok(tmm.getStatus(tmm.applyMove(S(b, 0, 4), pw!)).kind === 'win', 'completing a line during placement wins');

// 3. Movement phase + adjacency
b = empty(); [4, 0, 2].forEach((i) => (b[i] = 0)); [1, 3, 5].forEach((i) => (b[i] = 1));
const sm = S(b, 0, 6);
const mv = tmm.getLegalMoves(sm, null);
ok(mv.length > 0 && mv.every((m) => m.from !== undefined), 'movement phase yields slides (with from)');
ok(tmm.getLegalMoves(sm, 4).length === 3, 'centre man slides to its 3 empty neighbours (g/h/i row)');
ok(tmm.getLegalMoves(sm, 0).length === 0, 'a fully-surrounded corner man has no slide');

// 4. Win detection (diagonal) + stalemate handling
b = empty(); [0, 4, 8].forEach((i) => (b[i] = 0)); [1, 2, 3].forEach((i) => (b[i] = 1));
const st = tmm.getStatus(S(b, 1, 6));
ok(st.kind === 'win' && (st as any).winner === 0, 'three on a diagonal is a win');

// 5. The interactive tutorial challenge actually wins
const ch = tmm.tutorial.chapters.flatMap((c) => c.steps).find((s) => s.challenge)!;
ok(!!ch?.setup, 'has an interactive challenge with a setup');
const cs = tmm.deserialize(ch.setup!);
const sol = tmm.getLegalMoves(cs, null).find((m) => m.notation === ch.challenge!.solution[0]);
ok(!!sol, `challenge solution ${ch.challenge!.solution[0]} is a legal move`);
ok(tmm.getStatus(tmm.applyMove(cs, sol!)).kind === 'win', 'challenge solution wins for Black');

// 6. applyMove correctness (placement then slide)
const d = tmm.applyMove(s0, tmm.getLegalMoves(s0, null).find((m) => m.notation === 'b2')!);
ok(d.board[4] === 0 && d.turn === 1 && d.ply === 1, 'placing on b2 fills the centre, passes the turn');

// 7. AI is legal + timely
const t0 = Date.now();
const ai = tmm.chooseMove(s0, 'master');
ok(!!ai && tmm.getLegalMoves(s0, null).some((m) => m.id === ai!.id), 'master AI returns a legal opening move');
ok(Date.now() - t0 < 2500, `master AI opening is timely (${Date.now() - t0}ms)`);

// 8. Self-play stays legal and reaches a result (win or the draw cap)
let g = tmm.createInitialState(); let n = 0, illegal = false;
while (tmm.getStatus(g).kind === 'playing' && n < 100) {
  const m = tmm.chooseMove(g, 'medium');
  if (!m) break;
  if (!tmm.getLegalMoves(g, null).some((x) => x.id === m.id)) { illegal = true; break; }
  g = tmm.applyMove(g, m); n++;
}
ok(!illegal, 'AI never plays an illegal move in self-play');
ok(tmm.getStatus(g).kind !== 'playing' || n >= 100, `self-play reaches a result (${n} plies, ${tmm.getStatus(g).kind})`);

console.log(fail === 0 ? '\n✅ THREE MENS MORRIS OK' : `\n❌ ${fail} failure(s)`);
if (fail) process.exit(1);
