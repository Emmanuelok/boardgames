import { Position, initialState, fromFen } from '../src/games/chess/engine.ts';

let bad = 0;
function perft(pos: Position, depth: number): number {
  if (pos.hash !== pos.computeHash()) bad++;
  if (depth === 0) return 1;
  let n = 0;
  for (const m of pos.legalMoves()) { pos.make(m); n += perft(pos, depth - 1); pos.unmake(); }
  if (pos.hash !== pos.computeHash()) bad++; // hash restored after unmake
  return n;
}
function run(name: string, fen: string | null, depth: number, expect: number) {
  const pos = new Position(fen ? fromFen(fen) : initialState());
  const n = perft(pos, depth);
  console.log(`  ${n === expect && bad === 0 ? '✓' : '✗'} ${name}: perft(${depth})=${n} (expect ${expect}), hashErrors=${bad}`);
}
run('startpos', null, 4, 197281);
run('kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862);
run('ep-promo', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 4, 43238);
console.log(bad === 0 ? '\n✅ ZOBRIST HASH CONSISTENT' : `\n❌ ${bad} hash mismatches`);
