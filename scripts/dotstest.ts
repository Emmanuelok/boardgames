/** Dots and Boxes: rules, scoring/extra-turn, AI and guaranteed termination. */
import { initialState, applyEdge, chooseMove, legalEdges, winner, isOver, boxEdges, EDGES, R, C } from '../src/games/dotsandboxes/logic';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

const init = initialState();
ok(EDGES === 60 && R === 5 && C === 5, `board: 5×5 = 25 boxes, ${EDGES} edges`);
ok(legalEdges(init).length === 60 && init.scores[0] === 0 && init.turn === 0, 'initial: 60 free edges, Blue to move');

// A non-completing line passes the turn and scores nothing.
{
  const s = applyEdge(init, boxEdges(0, 0)[0]);
  ok(s.turn === 1 && s.scores[0] === 0, 'drawing one side passes the turn');
}
// Completing the 4th side claims the box AND keeps the turn.
{
  let s = initialState();
  const [a, b, c, d] = boxEdges(2, 2);
  s = applyEdge(s, a); // turn → 1
  s = applyEdge(s, b); // turn → 0
  s = applyEdge(s, c); // turn → 1
  const turnBefore = s.turn;
  s = applyEdge(s, d); // completes box (2,2) for `turnBefore`
  ok(s.owner[2 * C + 2] === turnBefore && s.scores[turnBefore] === 1 && s.turn === turnBefore, 'completing a box claims it and grants another move');
}
// Completing two boxes with one shared line claims both.
{
  let s = initialState();
  // Box (0,0) and (0,1) share the vertical edge between them. Fill all other sides first.
  for (const e of [...boxEdges(0, 0), ...boxEdges(0, 1)]) if (s.edges[e] === false) { /* will draw below */ }
  const shared = boxEdges(0, 0)[3]; // right of (0,0) == left of (0,1)
  const others = new Set([...boxEdges(0, 0), ...boxEdges(0, 1)].filter((e) => e !== shared));
  let turn = 0;
  for (const e of others) { const before = s.turn; s = applyEdge(s, e); if (s.turn === before) { /* would only happen on completion */ } turn = s.turn; }
  // Now draw the shared edge on whoever's turn it is; should complete BOTH boxes.
  const who = s.turn;
  s = applyEdge(s, shared);
  ok(s.scores[who] >= 2 && s.owner[0] === who && s.owner[1] === who, 'one line can claim two boxes at once');
  void turn;
}

// Winner only once full; AI returns legal moves.
ok(winner(init) === null && !isOver(init), 'no winner before the grid is full');
for (const d of ['easy', 'medium', 'hard'] as const) {
  const e = chooseMove(init, d);
  ok(e >= 0 && e < EDGES && !init.edges[e], `chooseMove(${d}) returns a legal edge (${e})`);
}

// AI vs AI always finishes (every move draws one edge → at most 60 draws).
{
  let s = initialState(), n = 0;
  const t0 = Date.now();
  while (!isOver(s) && n < 80) { s = applyEdge(s, chooseMove(s, 'hard')); n++; }
  ok(isOver(s) && winner(s) !== null, `AI vs AI completes: ${n} edges → ${winner(s) === 0 ? 'Blue' : 'Red'} (${s.scores.join('-')}) (${Date.now() - t0}ms)`);
}

console.log(fail === 0 ? '\n✅ DOTS AND BOXES OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
