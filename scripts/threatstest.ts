/** Proactive threat detection: warns about hanging pieces and mate threats on
 *  the side-to-move's turn, and stays quiet in calm positions. */
import { initialState, fromFen } from '../src/games/chess/engine';
import { chessThreats } from '../src/games/chess/tutor';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

// Calm start: nothing is hanging, no mate threats.
ok(chessThreats(initialState()).length === 0, `start position → no threats`);

// White to move; the White knight on e5 is attacked by ...d6 pawn and undefended.
const hang = chessThreats(fromFen('4k3/8/3p4/4N3/8/8/8/4K3 w - - 0 1'));
ok(hang.some((t) => /win your knight on e5/i.test(t)), `hanging knight → "${hang.join(' / ') || 'none'}"`);

// White to move (Kh1), Black threatens a one-move mate against the cornered king.
const mate = chessThreats(fromFen('6k1/1b6/8/8/8/5q2/6PP/7K w - - 0 1'));
ok(mate.some((t) => /threatening mate/.test(t)), `mate threat → "${mate.join(' / ') || 'none'}"`);

// A knight attacked by an equal piece and defended (knight trade nets nothing)
// must NOT be flagged — only real material wins are threats.
const safe = chessThreats(fromFen('4k3/3n4/8/4N3/3P4/8/8/4K3 w - - 0 1'));
ok(!safe.some((t) => /e5/i.test(t)), `equally-defended knight → not flagged ("${safe.join(' / ') || 'none'}")`);

console.log(fail === 0 ? '\n✅ THREAT DETECTION OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
