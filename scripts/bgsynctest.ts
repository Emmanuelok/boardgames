/**
 * Backgammon online-sync model test (no browser). Online play syncs the whole
 * BgState over the data channel after every action by the active player, so the
 * two peers must (a) survive a JSON round-trip with no loss, and (b) stay bit-
 * for-bit identical through a complete game. We simulate exactly that protocol.
 */
import {
  initialState, rollDice, withRoll, legalMoves, applyMove, turnIsOver, endTurn, winner, aiPlayTurn,
  type BgState,
} from '../src/games/backgammon/logic';

const key = (s: BgState) =>
  `${s.points.join(',')}|${s.bar.join(',')}|${s.off.join(',')}|${s.turn}|${[...s.dice].sort().join('')}`;
const wire = (s: BgState): BgState => JSON.parse(JSON.stringify(s)); // what the data channel does

let local = initialState(); // active player's authoritative state
let remote = wire(local); // opponent applies whatever arrives
let sends = 0, mismatches = 0, ply = 0;
let lastTurn = local.turn;
let turnFlips = 0;

const push = (st: BgState) => {
  local = st;
  remote = wire(st); // opponent receives + applies
  sends++;
  if (key(local) !== key(remote)) mismatches++;
  if (remote.turn !== lastTurn) { turnFlips++; lastTurn = remote.turn; }
};

while (winner(local) === null && ply < 6000) {
  // 1) Active player rolls and broadcasts.
  let rolled = withRoll(local, rollDice());
  if (legalMoves(rolled).length === 0) rolled = endTurn(rolled); // dance: no move
  push(rolled);

  // 2) Play the chosen sequence move-by-move, broadcasting after each (mirrors
  //    the component, which calls sendState() on every applyMove).
  if (local.dice.length) {
    const { moves } = aiPlayTurn(local, 'hard');
    for (const m of moves) {
      let after = applyMove(local, m);
      if (turnIsOver(after)) after = endTurn(after);
      push(after);
    }
    // Safety net: if the turn somehow still hasn't ended, end it.
    if (local.dice.length && legalMoves(local).length === 0) push(endTurn(local));
  }
  ply++;
}

const w = winner(local);
console.log(`game: ${ply} turns, ${sends} state syncs, ${turnFlips} turn changes`);
console.log(`winner: ${w === 0 ? 'White' : w === 1 ? 'Black' : 'none (cap hit)'}  off=[${local.off.join(',')}]`);
console.log(`final states identical after every sync: ${mismatches === 0 ? 'YES' : `NO (${mismatches} mismatches)`}`);

// Round-trip a mid-game state with bar + dice to be thorough about lossless wire.
const probe = endTurn(withRoll(applyMove(withRoll(initialState(), [6, 1]), { from: 23, to: 17, die: 6 }), [3, 3, 3, 3]));
const ok = key(probe) === key(wire(probe));
console.log(`lossless JSON round-trip (bar/dice/doubles probe): ${ok ? 'YES' : 'NO'}`);

if (mismatches === 0 && w !== null && ok && turnFlips > 4) {
  console.log('\n✅ BACKGAMMON ONLINE SYNC OK');
} else {
  console.log('\n❌ BACKGAMMON ONLINE SYNC FAILED');
  process.exit(1);
}
