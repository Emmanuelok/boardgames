import { GAMES } from '../src/engine/registry';
import type { Difficulty, GameDefinition } from '../src/engine/types';

function boardSig(def: GameDefinition, s: any): string {
  return def.getBoardView(s).cells.map((c) => (c.piece ? `${c.piece.kind}${c.piece.player}` : '.')).join('');
}

function legalIds(def: GameDefinition, s: any): Set<string> {
  return new Set(def.getLegalMoves(s, null).map((m) => m.id));
}

let failures = 0;
const assert = (cond: boolean, msg: string) => { if (!cond) { failures++; console.log('   ✗ FAIL: ' + msg); } };

for (const def of GAMES) {
  if (def.custom) { console.log(`\n=== ${def.name} (${def.id}) === [custom renderer — skipped here]`); continue; }
  console.log(`\n=== ${def.name} (${def.id}) ===`);
  try {
    const init = def.createInitialState();

    // serialize roundtrip
    const round = def.deserialize(def.serialize(init));
    assert(boardSig(def, round) === boardSig(def, init), 'serialize/deserialize preserves the board');

    // initial legal moves
    const legal0 = def.getLegalMoves(init, null);
    assert(legal0.length > 0, 'has legal moves at start');

    // chooseMove legality for several difficulties
    for (const d of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const t0 = Date.now();
      const m = def.chooseMove(init, d);
      const dt = Date.now() - t0;
      assert(!!m && legalIds(def, init).has(m.id), `chooseMove(${d}) returns a legal move`);
      console.log(`   chooseMove(${d}): ${m?.notation}  (${dt}ms)`);
    }

    // explainMove on first move
    const firstMove = def.chooseMove(init, 'medium')!;
    const after1 = def.applyMove(init, firstMove);
    const exp = def.explainMove(init, firstMove, after1);
    assert(!!exp.summary && Array.isArray(exp.insights) && !!exp.band, 'explainMove returns a structured explanation');
    console.log(`   explain "${firstMove.notation}": [${exp.band}] ${exp.summary.slice(0, 70)}`);

    // hint
    const h = def.hint(init);
    console.log(`   hint: ${h ? h.text.slice(0, 70) : '(none)'}`);

    // Play AI vs AI to completion (or cap)
    let s = init;
    let plies = 0;
    let status = def.getStatus(s);
    const cap = def.id === 'gomoku' ? 120 : def.id === 'checkers' ? 160 : 250;
    while (status.kind === 'playing' || status.kind === 'check') {
      if (plies >= cap) break;
      const moves = def.getLegalMoves(s, null);
      if (moves.length === 0) { failures++; console.log('   ✗ no moves but status not terminal'); break; }
      const mv = def.chooseMove(s, 'medium');
      if (!mv) { failures++; console.log('   ✗ chooseMove returned null mid-game'); break; }
      if (!legalIds(def, s).has(mv.id)) { failures++; console.log('   ✗ chose illegal move ' + mv.id); break; }
      s = def.applyMove(s, mv);
      status = def.getStatus(s);
      plies++;
    }
    const res = status.kind === 'win' ? `${def.players[(status as any).winner].name} wins (${(status as any).reason})`
      : status.kind === 'draw' ? `draw (${(status as any).reason})`
      : `capped at ${plies}`;
    console.log(`   AI vs AI: ${plies} plies → ${res}`);
    assert(plies > 0, 'game advanced at least one ply');
  } catch (err) {
    failures++;
    console.log('   ✗ EXCEPTION: ' + (err as Error).stack);
  }
}

console.log(`\n${failures === 0 ? '✅ ALL GAMES PASSED' : `❌ ${failures} FAILURE(S)`}`);
