import { Position, initialState, fromFen } from '../src/games/chess/engine.ts';

function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = pos.legalMoves();
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const m of moves) {
    pos.make(m);
    nodes += perft(pos, depth - 1);
    pos.unmake();
  }
  return nodes;
}

function run(name: string, fen: string | null, expected: number[]) {
  const state = fen ? fromFen(fen) : initialState();
  console.log(`\n== ${name} ==`);
  for (let d = 1; d <= expected.length; d++) {
    const pos = new Position(state);
    const t0 = Date.now();
    const n = perft(pos, d);
    const ok = n === expected[d - 1];
    console.log(`  depth ${d}: ${n} ${ok ? 'OK' : `WRONG (expected ${expected[d - 1]})`} (${Date.now() - t0}ms)`);
  }
}

// Known perft values.
run('startpos', null, [20, 400, 8902, 197281]);
// "Kiwipete" — a famous position exercising castling, en passant, promotions.
run('kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]);
// Position with en passant + promotions edge cases.
run('ep-promo', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]);
