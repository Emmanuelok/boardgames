import kono from '../src/games/fivefieldkono';

let fail = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };
const empty = () => Array(25).fill(null) as (0 | 1 | null)[];
const S = (b: (0 | 1 | null)[], turn = 0, ply = 0) => kono.deserialize(JSON.stringify({ board: b, turn, ply }));
const START0 = [0, 1, 2, 3, 4, 5, 9], START1 = [15, 19, 20, 21, 22, 23, 24];

// 1. Initial layout
const s0 = kono.createInitialState();
ok(START0.every((i) => s0.board[i] === 0), 'Blue starts on the top seven cells');
ok(START1.every((i) => s0.board[i] === 1), 'Orange starts on the bottom seven cells');
ok(kono.getTurn(s0) === 0, 'Blue moves first');
ok(s0.board.filter((x: any) => x === 0).length === 7 && s0.board.filter((x: any) => x === 1).length === 7, 'seven stones each');

// 2. Moves are diagonal-only slides
const open = kono.getLegalMoves(s0, null);
ok(open.length > 0 && open.every((m) => m.from !== undefined), 'opening moves are slides (with from)');
ok(open.every((m) => { const fr = Math.floor(m.from! / 5), fc = m.from! % 5, tr = Math.floor(m.to / 5), tc = m.to % 5; return Math.abs(fr - tr) === 1 && Math.abs(fc - tc) === 1; }), 'every move is one step diagonally');

// 3. A lone centre stone reaches its 4 diagonal neighbours; parity is preserved
let b = empty(); b[12] = 0;
const c = kono.getLegalMoves(S(b, 0), 12);
ok(c.length === 4, 'a free centre stone has 4 diagonal moves');
ok(c.every((m) => ((Math.floor(m.to / 5) + (m.to % 5)) % 2) === ((Math.floor(12 / 5) + (12 % 5)) % 2)), 'a diagonal move keeps the stone on its colour (parity)');

// 4. Win detection: Blue filling Orange's start
b = empty(); START1.forEach((i) => (b[i] = 0)); [6, 7, 8, 11, 12, 13, 16].forEach((i) => (b[i] = 1));
const st = kono.getStatus(S(b, 1, 30));
ok(st.kind === 'win' && (st as any).winner === 0, 'all seven Blue stones on the far camp is a win');

// 5. The interactive tutorial challenge actually wins
const ch = kono.tutorial.chapters.flatMap((c) => c.steps).find((s) => s.challenge)!;
ok(!!ch?.setup, 'has an interactive challenge with a setup');
const cs = kono.deserialize(ch.setup!);
ok(cs.board.filter((x: any) => x === 0).length === 7 && cs.board.filter((x: any) => x === 1).length === 7, 'challenge position is well-formed (7 + 7 stones)');
const sol = kono.getLegalMoves(cs, null).find((m) => m.notation === ch.challenge!.solution[0]);
ok(!!sol, `challenge solution ${ch.challenge!.solution[0]} is a legal move`);
ok(kono.getStatus(kono.applyMove(cs, sol!)).kind === 'win', 'challenge solution wins for Blue');

// 6. applyMove correctness
const m0 = kono.getLegalMoves(s0, null)[0];
const a0 = kono.applyMove(s0, m0);
ok(a0.board[m0.from!] === null && a0.board[m0.to] === 0 && a0.turn === 1 && a0.ply === 1, 'applyMove vacates the source, fills the target, passes the turn');

// 7. AI legal + timely
const t0 = Date.now();
const ai = kono.chooseMove(s0, 'master');
ok(!!ai && kono.getLegalMoves(s0, null).some((m) => m.id === ai!.id), 'master AI returns a legal opening move');
ok(Date.now() - t0 < 3000, `master AI opening is timely (${Date.now() - t0}ms)`);

// 8. Self-play stays legal and reaches a result (win or the draw cap)
let g = kono.createInitialState(); let n = 0, illegal = false;
while (kono.getStatus(g).kind === 'playing' && n < 400) {
  const m = kono.chooseMove(g, 'medium');
  if (!m) break;
  if (!kono.getLegalMoves(g, null).some((x) => x.id === m.id)) { illegal = true; break; }
  g = kono.applyMove(g, m); n++;
}
ok(!illegal, 'AI never plays an illegal move in self-play');
ok(kono.getStatus(g).kind !== 'playing' || n >= 400, `self-play reaches a result (${n} plies, ${kono.getStatus(g).kind})`);

console.log(fail === 0 ? '\n✅ FIVE FIELD KONO OK' : `\n❌ ${fail} failure(s)`);
if (fail) process.exit(1);
