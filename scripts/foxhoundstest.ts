/** Fox & Hounds: asymmetric movement, win conditions, AI, guaranteed termination. */
import def from '../src/games/foxandhounds';
import type { Player } from '../src/engine/types';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

type S = { squares: ({ player: Player } | null)[]; turn: Player };
const idx = (r: number, c: number) => r * 8 + c;
const empty = (): S => ({ squares: Array(64).fill(null), turn: 0 });

const init = def.createInitialState() as S;
ok(init.squares.filter((p) => p?.player === 1).length === 4, 'starts with four hounds');
ok(init.squares.filter((p) => p?.player === 0).length === 1, 'starts with one fox');
ok(init.turn === 0, 'the fox moves first');

// Fox roams all four diagonals; hounds only step forward (down).
{
  const s: S = empty(); s.squares[idx(4, 3)] = { player: 0 }; s.turn = 0;
  const dests = (def.getLegalMoves(s as any) as any[]).map((m) => m.to).sort((a, b) => a - b);
  ok(JSON.stringify(dests) === JSON.stringify([idx(3, 2), idx(3, 4), idx(5, 2), idx(5, 4)].sort((a, b) => a - b)), 'fox has four diagonal steps from the centre');
  const h: S = empty(); h.squares[idx(4, 3)] = { player: 1 }; h.turn = 1;
  const hd = (def.getLegalMoves(h as any) as any[]).map((m) => m.to).sort((a, b) => a - b);
  ok(JSON.stringify(hd) === JSON.stringify([idx(5, 2), idx(5, 4)].sort((a, b) => a - b)), 'a hound only steps forward (two options)');
}

// Win conditions.
{
  const foxThrough: S = empty(); foxThrough.squares[idx(0, 3)] = { player: 0 }; foxThrough.squares[idx(2, 1)] = { player: 1 }; foxThrough.turn = 1;
  ok(def.getStatus(foxThrough as any).kind === 'win' && (def.getStatus(foxThrough as any) as any).winner === 0, 'fox on the top row wins');
  // Fox boxed in a corner with no diagonal step → hounds win.
  const trapped: S = empty();
  trapped.squares[idx(7, 0)] = { player: 0 };
  trapped.squares[idx(6, 1)] = { player: 1 };
  trapped.turn = 0;
  ok((def.getLegalMoves(trapped as any) as any[]).length === 0 && def.getStatus(trapped as any).kind === 'win' && (def.getStatus(trapped as any) as any).winner === 1, 'a fox with no move is trapped — hounds win');
}

// evaluate: fox near the top scores high; trapped/escaped are decisive.
{
  const near: S = empty(); near.squares[idx(1, 2)] = { player: 0 }; near.squares[idx(4, 5)] = { player: 1 }; near.turn = 0;
  const far: S = empty(); far.squares[idx(6, 2)] = { player: 0 }; far.squares[idx(4, 5)] = { player: 1 }; far.turn = 0;
  ok(def.evaluate!(near as any) > def.evaluate!(far as any), 'the fox is valued higher the closer it is to breaking through');
}

// AI moves at every difficulty, deterministically, and quickly.
for (const d of ['easy', 'medium', 'hard', 'master'] as const) ok(!!def.chooseMove!(init as any, d), `chooseMove(${d}) → ${(def.chooseMove!(init as any, d) as any)?.notation}`);
ok((def.chooseMove!(init as any, 'master') as any)?.id === (def.chooseMove!(init as any, 'master') as any)?.id, 'chooseMove is deterministic');
{ const t0 = Date.now(); def.chooseMove!(init as any, 'master'); const ms = Date.now() - t0; ok(ms < 3000, `master opening move in ${ms}ms (<3000)`); }

// Termination is structural: hounds only advance, so a full game always ends.
{
  let s = init as any, plies = 0; const t0 = Date.now();
  while (def.getStatus(s).kind === 'playing' && plies < 200) {
    const m = def.chooseMove!(s, plies % 2 === 0 ? 'medium' : 'hard'); if (!m) break; s = def.applyMove(s, m); plies++;
  }
  const st = def.getStatus(s);
  ok(st.kind === 'win' && plies < 200, `fox vs hounds ends in ${plies} plies → ${(st as any).winner === 0 ? 'Fox' : 'Hounds'} (${Date.now() - t0}ms)`);
}

// serialize / deserialize roundtrip.
ok(def.serialize(def.deserialize(def.serialize(init as any))) === def.serialize(init as any), 'serialize/deserialize roundtrip');

console.log(fail === 0 ? '\n✅ FOX & HOUNDS OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
