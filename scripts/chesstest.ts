import { initialState, applyChessMove, legalMovesFor, Position } from '../src/games/chess/engine';
import { bestMove, analyze } from '../src/games/chess/search';
import { explainChessMove, chessHint } from '../src/games/chess/tutor';
import { OPENING_BOOK } from '../src/games/chess/book';

console.log('Opening book positions:', Object.keys(OPENING_BOOK).length);

// 1. Legal move count from start
let s = initialState();
console.log('Start legal moves:', legalMovesFor(s).length, '(expect 20)');

// 2. Timing for each difficulty
for (const d of ['easy', 'medium', 'hard', 'master'] as const) {
  const t0 = Date.now();
  const m = bestMove(s, d);
  console.log(`bestMove ${d}: ${m?.notation}  (${Date.now() - t0}ms)`);
}

// 3. Play an AI-vs-AI game (medium) for up to 60 plies, ensure no crash
s = initialState();
let plies = 0;
const sans: string[] = [];
for (; plies < 60; plies++) {
  const moves = legalMovesFor(s);
  if (moves.length === 0) break;
  const m = bestMove(s, 'medium');
  if (!m) break;
  const pos = new Position(s);
  sans.push(pos.toSAN(m));
  s = applyChessMove(s, m);
}
console.log(`\nAI vs AI ${plies} plies OK. First 14:`, sans.slice(0, 14).join(' '));

// 4. Tutor: explain a deliberate blunder (1.e4 e5 2.Qh5 Nc6 3.Bc4 ... then black blunders ...Nf6?? allowing Qxf7#? no)
// Simpler: explain a hanging-queen blunder.
s = initialState();
const play = (san: string) => {
  const pos = new Position(s);
  const m = legalMovesFor(s).find((mv) => pos.toSAN(mv).replace(/[+#]/g, '') === san);
  if (!m) throw new Error('illegal in test: ' + san);
  const before = s;
  const after = applyChessMove(s, m);
  return { before, m, after };
};
// 1.e4
let step = play('e4'); s = step.after;
let ex = explainChessMove(step.before, step.m, step.after);
console.log(`\n1.e4 -> band=${ex.band} | ${ex.summary}`);
console.log('   insights:', ex.insights.map((i) => i.tag).join(', '));

// 1...e5 2.Nf3 develops
step = play('e5'); s = step.after;
step = play('Nf3'); s = step.after;
ex = explainChessMove(step.before, step.m, step.after);
console.log(`2.Nf3 -> band=${ex.band} | ${ex.summary}`);
console.log('   principles:', ex.principles.join(' | '));

// 2...Qf6?! bringing queen out early; 3.Nc3; 3...Qxf3?? hanging-queen blunder grabbing knight defended by pawn
step = play('Qf6'); s = step.after;
step = play('Nc3'); s = step.after;
step = play('Qxf3'); s = step.after;
ex = explainChessMove(step.before, step.m, step.after);
console.log(`3...Qxf3 -> band=${ex.band} | ${ex.summary}`);
console.log('   insights:', ex.insights.map((i) => `[${i.tone}] ${i.tag}`).join(', '));
console.log('   betterIdea:', ex.betterIdea);

// 5. Hint from start
const h = chessHint(initialState());
console.log('\nHint from start:', h?.text);

// 6. Knight fork detection: white Nc7 forking king e8 and rook a8
const forkState = (await import('../src/games/chess/engine')).fromFen('r3k3/8/8/8/8/8/8/N3K3 w - - 0 1');
const posF = new Position(forkState);
const nb = legalMovesFor(forkState).find((mv) => posF.toSAN(mv).replace(/[+#]/g, '') === 'Nb3')
  ?? legalMovesFor(forkState)[0];
// move knight a1->c2->... not direct; instead set knight on a8-adjacent. Use simpler fork test:
const forkState2 = (await import('../src/games/chess/engine')).fromFen('r3k3/8/2N5/8/8/8/8/4K3 b - - 0 1');
// it's black to move with white Nc7 already forking — explain black's forced king move reaction not needed.
// Instead verify forkTargets via a white move into the fork: put knight on a6, move Nc7.
const fs3 = (await import('../src/games/chess/engine')).fromFen('r3k3/8/N7/8/8/8/8/4K3 w - - 0 1');
const pos3 = new Position(fs3);
const nc7 = legalMovesFor(fs3).find((mv) => pos3.toSAN(mv).replace(/[+#]/g, '') === 'Nc7');
if (nc7) {
  const after = applyChessMove(fs3, nc7);
  const exf = explainChessMove(fs3, nc7, after);
  console.log('\nNc7 fork -> band=' + exf.band + ' | ' + exf.summary);
  console.log('   insights:', exf.insights.map((i) => i.tag).join(', '));
}
void nb; void forkState2;
