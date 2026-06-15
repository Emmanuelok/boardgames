import { fromFen, initialState, applyChessMove, legalMovesFor, Position } from '../src/games/chess/engine';
import { analyze, bestMove, searchBest } from '../src/games/chess/search';

const norm = (s: string) => s.replace(/[+#]/g, '');
const tactics: Array<[string, string, string]> = [
  ['mate in 1', '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'Ra8'],
  ['royal fork', '4k3/5q2/8/8/2N5/8/8/4K3 w - - 0 1', 'Nd6'],
  ['fork K+R', 'r3k3/8/N7/8/8/8/8/4K3 w - - 0 1', 'Nc7'],
  ['win the queen', '4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 'exd5'],
  ['back-rank mate in 2', '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'Rd8'],
];

let fail = 0;
console.log('Tactics (analyze depth 8, 2000ms):');
for (const [name, fen, want] of tactics) {
  const t0 = Date.now();
  const out = analyze(fromFen(fen), 8, 2000);
  const got = out.best ? norm(out.best.notation) : '?';
  const ok = got === want;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}: got ${got} want ${want}  (d${out.depth}, ${out.nodes} nodes, ${Date.now() - t0}ms)`);
}

// Timing: deepen a fresh midgame-ish position at master depth.
let s = initialState();
for (const san of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7']) {
  const pos = new Position(s);
  const m = legalMovesFor(s).find((x) => norm(pos.toSAN(x)) === san)!;
  s = applyChessMove(s, m);
}
const t1 = Date.now();
const out = searchBest(s, 12, 4000);
console.log(`\nMidgame searchBest (pruned, master): best ${out.move?.notation}, reached d${out.depth}, ${out.nodes} nodes, ${Date.now() - t1}ms`);

// Self-play sanity at hard for a few plies + timing.
s = initialState();
let maxMs = 0;
for (let i = 0; i < 16; i++) {
  const t = Date.now();
  const m = bestMove(s, 'hard');
  maxMs = Math.max(maxMs, Date.now() - t);
  if (!m) break;
  s = applyChessMove(s, m);
}
console.log(`hard self-play 16 plies OK, slowest move ${maxMs}ms`);
console.log(fail === 0 ? '\n✅ ENGINE TACTICS PASS' : `\n❌ ${fail} tactic(s) missed`);
