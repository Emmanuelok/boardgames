import { useGameStore } from '../src/store/useGameStore';

let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗ FAIL'} ${m}`); if (!c) fail++; };
const S = () => useGameStore.getState();

// Pass-and-play, no tutor, so no async AI/worker involved.
useGameStore.setState({ mode: 'pass', autoTutor: false });

// --- place game (Tic-Tac-Toe) via the unified resolver ---
S().newGame('tic-tac-toe');
ok(S().log.length === 0, 'ttt starts empty');
S().onCellClick(4); // center
ok(S().log.length === 1 && S().state.board[4] !== null, 'ttt: click places a mark (placement path)');
S().onCellClick(4); // occupied — no-op
ok(S().log.length === 1, 'ttt: clicking an occupied cell does nothing');

// --- move game (Chess): select then move ---
useGameStore.setState({ mode: 'pass', autoTutor: false });
S().newGame('chess');
S().onCellClick(52); // white pawn e2
ok(S().selected === 52, 'chess: clicking own pawn selects it (source path)');
ok(S().targets.length === 2, 'chess: pawn shows 2 targets (e3, e4)');
S().onCellClick(36); // e4
ok(S().log.length === 1 && S().selected === null, 'chess: clicking target plays the move & deselects');
ok(S().state.board[36] === 1 /* white pawn code */, 'chess: pawn is now on e4');
S().onCellClick(20); // empty, no selection -> nothing
ok(S().log.length === 1, 'chess: clicking empty with no selection is a no-op');

// reselect + switch source
S().newGame('chess');
S().onCellClick(57); // b1 knight
ok(S().selected === 57, 'chess: select knight');
S().onCellClick(62); // g1 knight (another source) -> reselect
ok(S().selected === 62, 'chess: clicking another own piece reselects');

// --- adaptive game (Nine Men's Morris): place, then a mill -> remove ---
useGameStore.setState({ mode: 'pass', autoTutor: false });
S().newGame('nine-mens-morris');
// Drive White to build a mill on the top outer line 0-3-6, then remove.
// Place at 0 (W), 8 (B), 3 (W), 10 (B), 6 (W) -> White mill 0-3-6 -> removing.
const seq = [0, 8, 3, 10, 6];
for (const c of seq) S().onCellClick(c);
ok(S().state.removing === true, 'morris: completing a mill enters removal (turn stays)');
ok(S().def!.getTurn(S().state) === 0, 'morris: White still to move during removal');
// Remove a black man (8) via a direct click (removal move has from undefined)
const before = S().log.length;
S().onCellClick(8);
ok(S().log.length === before + 1 && S().state.board[8] === null, 'morris: removal click captures the man');
ok(S().state.removing === false && S().def!.getTurn(S().state) === 1, 'morris: after removal, turn passes to Black');

console.log(fail === 0 ? '\n✅ STORE RESOLVER OK' : `\n❌ ${fail} failure(s)`);
