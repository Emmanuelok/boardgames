/**
 * The chess tutor — the heart of the teaching experience.
 *
 * Given the position before a move, the move, and the position after, it
 * produces a rich, human explanation: a quality grade (Brilliant … Blunder),
 * before/after evaluation, and concrete insights — captures and whether they
 * win or lose material (via Static Exchange Evaluation), hanging pieces, forks,
 * development, castling, centre control, promotions, checks, the threats the
 * move creates, and a stronger idea when the move falls short.
 */
import {
  Position, type ChessMove, type ChessState, type Color,
  WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  typeOf, colorOf, fileOf, rankOf, algebraic, PIECE_NAME,
} from './engine';
import { MATERIAL, MATE } from './evaluate';
import { analyze } from './search';
import type { EvalBand, MoveExplanation, MoveInsight, Player } from '../../engine/types';
import { gradeByLoss } from '../../engine/grade';

const VAL = (code: number) => (typeOf(code) === KING ? 20000 : MATERIAL[typeOf(code)] ?? 0);

/** Static Exchange Evaluation: material `side` wins by initiating captures on `sq`
 *  (ignores x-ray reveals — a good approximation for teaching). */
function see(pos: Position, sq: number, side: Color): number {
  const occupant = pos.board[sq];
  const occVal = occupant === 0 ? 0 : VAL(occupant);
  const own = pos.attackersOf(sq, side).map((f) => VAL(pos.board[f])).sort((a, b) => a - b);
  const opp = pos.attackersOf(sq, (side ^ 1) as Color).map((f) => VAL(pos.board[f])).sort((a, b) => a - b);
  if (own.length === 0) return 0; // can't capture
  const lists: number[][] = [];
  lists[side] = own;
  lists[(side ^ 1) as Color] = opp;
  const ptr: number[] = [];
  ptr[side] = 0; ptr[(side ^ 1) as Color] = 0;

  const gain: number[] = [occVal];
  let onSquare = lists[side][ptr[side]++]; // side's least attacker moves onto the square
  let stm = (side ^ 1) as Color;
  let d = 0;
  while (ptr[stm] < lists[stm].length) {
    d++;
    gain[d] = onSquare - gain[d - 1];
    onSquare = lists[stm][ptr[stm]++];
    stm = (stm ^ 1) as Color;
  }
  for (let k = d; k > 0; k--) gain[k - 1] = -Math.max(-gain[k - 1], gain[k]);
  return gain[0];
}

/** The opponent's most profitable capture in this position (used to spot hangs). */
function bestOppCapture(pos: Position, opp: Color): { sq: number; gain: number } {
  let best = { sq: -1, gain: 0 };
  for (let sq = 0; sq < 64; sq++) {
    const p = pos.board[sq];
    if (p === 0 || colorOf(p) === opp) continue; // must be an enemy (of opp) piece to capture
    if (pos.attackersOf(sq, opp).length === 0) continue;
    const g = see(pos, sq, opp);
    if (g > best.gain) best = { sq, gain: g };
  }
  return best;
}

/** Targets the piece now on `from` attacks that would win material if grabbed. */
function forkTargets(pos: Position, from: number, mover: Color): number[] {
  const targets: number[] = [];
  for (const to of pos.attacksFrom(from)) {
    const p = pos.board[to];
    if (p === 0 || colorOf(p) === mover) continue;
    if (typeOf(p) === KING) { targets.push(to); continue; }
    if (see(pos, to, mover) > 90) targets.push(to);
  }
  return targets;
}

const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Does the slider that just moved to `fromSq` pin or skewer an enemy piece
 *  against a more valuable one (or the king) behind it? */
function pinBy(pos: Position, fromSq: number, mover: Color): { pinned: number; behind: number; absolute: boolean } | null {
  const p = pos.board[fromSq];
  const t = typeOf(p);
  const dirs = t === ROOK ? ROOK_D : t === BISHOP ? BISHOP_D : t === QUEEN ? [...ROOK_D, ...BISHOP_D] : null;
  if (!dirs) return null;
  const opp = (mover ^ 1) as Color;
  for (const [dr, dc] of dirs) {
    let r = rankOf(fromSq) + dr, c = fileOf(fromSq) + dc;
    let first = -1;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) { const sq = r * 8 + c; if (pos.board[sq] !== 0) { first = sq; break; } r += dr; c += dc; }
    if (first < 0 || colorOf(pos.board[first]) === mover) continue;
    r += dr; c += dc;
    let second = -1;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) { const sq = r * 8 + c; if (pos.board[sq] !== 0) { second = sq; break; } r += dr; c += dc; }
    if (second < 0 || colorOf(pos.board[second]) !== opp) continue;
    if (typeOf(pos.board[second]) === KING || VAL(pos.board[second]) > VAL(pos.board[first])) {
      return { pinned: first, behind: second, absolute: typeOf(pos.board[second]) === KING };
    }
  }
  return null;
}

const isCenter = (sq: number) => [27, 28, 35, 36].includes(sq); // d5 e5 d4 e4
const isBigCenter = (sq: number) => {
  const f = fileOf(sq), r = rankOf(sq);
  return f >= 2 && f <= 5 && r >= 2 && r <= 5;
};

function whitePersp(moverScore: number, mover: Color): number {
  return mover === WHITE ? moverScore : -moverScore;
}

export function explainChessMove(before: ChessState, move: ChessMove, after: ChessState): MoveExplanation {
  const mover = before.turn as Color;
  const opp = (mover ^ 1) as Color;
  const posBefore = new Position(before);
  const posAfter = new Position(after);
  if (!move.notation) move.notation = posBefore.toSAN(move);

  // One search drives the grade and the "better idea".
  const out = analyze(before, 4, 650);
  const best = out.ranked[0];
  const played = out.ranked.find((r) => r.move.id === move.id) ?? { move, score: best?.score ?? 0 };
  const loss = Math.max(0, (best?.score ?? played.score) - played.score);

  const insights: MoveInsight[] = [];
  const principles: string[] = [];
  const threats: string[] = [];

  const afterMoves = posAfter.legalMoves();
  const oppInCheck = posAfter.inCheck(opp);
  const isMate = oppInCheck && afterMoves.length === 0;
  const isStalemate = !oppInCheck && afterMoves.length === 0;

  const movedType = typeOf(move.piece);
  const movedName = PIECE_NAME[movedType];

  // --- Captures & material (SEE on the destination, from the mover's side) ---
  let sacrifice = false;
  if (move.capture) {
    const victim = move.isEP ? 'pawn' : PIECE_NAME[typeOf(move.captured)];
    const exchange = see(posBefore, move.to, mover);
    if (exchange >= 90) {
      insights.push({ tag: 'Wins material', detail: `Captures the ${victim} and comes out ahead by roughly ${(exchange / 100).toFixed(1)} points.`, tone: 'good' });
      principles.push('Win material when you can do so safely.');
    } else if (exchange >= -20) {
      insights.push({ tag: 'Fair trade', detail: `Takes the ${victim} in an even exchange.`, tone: 'info' });
    } else {
      sacrifice = true;
      insights.push({ tag: 'Sacrifice', detail: `Gives up material by taking the ${victim} — only good if it leads to something concrete.`, tone: 'info' });
    }
  }

  // --- Did the move hang something? (opponent's best reply wins material) ---
  const oppBest = bestOppCapture(posAfter, opp);
  const hangVictim = oppBest.sq >= 0 ? pos2name(posAfter, oppBest.sq) : '';
  if (oppBest.gain >= 150 && loss >= 120) {
    sacrifice = false;
    insights.push({ tag: 'Hangs a piece', detail: `Leaves the ${hangVictim} undefended — the opponent can win it with ${algebraic(oppBest.sq)}.`, tone: 'bad' });
    principles.push('Before moving, check every piece is defended or safe.');
  }

  // --- Fork by the piece that just moved ---
  const targets = forkTargets(posAfter, move.to, mover);
  if (targets.length >= 2) {
    const names = targets.map((t) => pos2name(posAfter, t)).join(' and ');
    insights.push({ tag: targets.length >= 2 ? 'Fork!' : 'Double attack', detail: `The ${movedName} attacks the ${names} at once — they can't all be saved.`, tone: 'good' });
    principles.push('A fork attacks two targets simultaneously; the opponent can only answer one.');
    threats.push(`Win one of: ${names}.`);
  } else if (targets.length === 1 && typeOf(posAfter.board[targets[0]]) === KING) {
    // handled as check below
  } else if (targets.length === 1) {
    threats.push(`Threatens to win the ${pos2name(posAfter, targets[0])}.`);
  }

  // --- Pin / skewer created by the piece that just moved ---
  const pin = pinBy(posAfter, move.to, mover);
  if (pin && !move.castle) {
    const pinnedName = pos2name(posAfter, pin.pinned);
    if (pin.absolute) {
      insights.push({ tag: 'Pin', detail: `Pins the ${pinnedName} against the king — it is now frozen and cannot legally move.`, tone: 'good' });
      principles.push('A pin freezes a piece shielding a more valuable one; pile up on what is pinned.');
    } else {
      insights.push({ tag: 'Pin / skewer', detail: `Lines the ${pinnedName} up in front of the ${pos2name(posAfter, pin.behind)} — win one or the other along the line.`, tone: 'good' });
      principles.push('Pins and skewers win material by attacking two pieces on one line.');
    }
  }

  // --- Checks / mate / stalemate ---
  if (isMate) {
    insights.unshift({ tag: 'Checkmate', detail: 'The enemy king is attacked and has no escape — the game is won.', tone: 'good' });
  } else if (oppInCheck) {
    const oppKing = posAfter.kingSquare(opp);
    const givers = posAfter.attackersOf(oppKing, mover);
    const discovered = givers.length > 0 && givers.every((s) => s !== move.to);
    if (discovered) {
      insights.push({ tag: 'Discovered check', detail: 'Moving this piece unveils a check from the piece behind it — you attack with tempo while the opponent is forced to answer the check.', tone: 'good' });
      principles.push('Discovered attacks unleash a second piece — devastating when they come with check.');
    } else {
      insights.push({ tag: 'Check', detail: 'Attacks the enemy king, forcing an immediate response.', tone: 'good' });
    }
  }
  if (isStalemate) {
    insights.push({ tag: 'Stalemate', detail: 'The opponent has no legal move but is not in check — the game is an immediate draw.', tone: 'bad' });
  }

  // --- Development, castling, centre, promotion (opening/teaching cues) ---
  const moverBackRank = mover === WHITE ? 7 : 0;
  if (move.castle) {
    insights.push({ tag: 'Castles', detail: 'Tucks the king into safety and connects the rooks — a key opening goal.', tone: 'good' });
    principles.push('Castle early to safeguard your king.');
  } else if ((movedType === KNIGHT || movedType === BISHOP) && rankOf(move.from) === moverBackRank && rankOf(move.to) !== moverBackRank) {
    insights.push({ tag: 'Develops', detail: `Brings the ${movedName} off the back rank toward the centre — develop a new piece every move in the opening.`, tone: 'good' });
    principles.push('Develop your knights and bishops before launching an attack.');
  }
  if (move.promo) {
    insights.push({ tag: 'Promotion', detail: `The pawn becomes a ${PIECE_NAME[move.promo]} — a decisive material gain.`, tone: 'good' });
    principles.push('Passed pawns must be pushed — promotion is often game-winning.');
  }
  if (movedType === PAWN && isCenter(move.to) && before.full <= 6) {
    insights.push({ tag: 'Centre', detail: 'Stakes a claim in the centre, opening lines for your pieces and cramping the opponent.', tone: 'good' });
    principles.push('Control the centre — central pawns and pieces dominate the board.');
  } else if (movedType !== PAWN && before.full <= 8 && isBigCenter(move.to) && !insights.some((i) => i.tag === 'Develops')) {
    principles.push('Centralise your pieces where they control the most squares.');
  }

  // --- Threats: material the move now menaces next move ---
  collectThreats(posAfter, mover, threats);

  // --- Grade ---
  const playedWhite = whitePersp(played.score, mover);
  const winningBig = played.score > 350;
  let band: EvalBand = isMate ? 'best' : gradeByLoss(loss, winningBig);
  if (sacrifice && loss <= 30 && played.score > -50) band = before.full <= 12 ? 'brilliant' : 'great';
  if (move.castle && loss <= 30 && band !== 'brilliant') band = band === 'best' ? 'best' : 'good';
  if (isMate) band = sacrifice ? 'brilliant' : 'best';
  if (out.ranked.length && played.move.id === best.move.id && !sacrifice && !isMate) band = winningBig ? 'great' : 'best';

  if (insights.length === 0) {
    insights.push({ tag: 'Quiet move', detail: 'A solid, non-forcing move that improves the position without immediate fireworks.', tone: 'info' });
  }

  // --- Better idea when the move gives ground ---
  let betterIdea: string | undefined;
  if (loss >= 60 && best && best.move.id !== move.id) {
    betterIdea = `${best.move.notation} kept more — ${reasonFor(before, best.move)}.`;
  }

  // --- Summary headline ---
  const summary = makeSummary({ isMate, oppInCheck, sacrifice, targets, move, movedName, insights });

  return {
    summary,
    band,
    evalBefore: whitePersp(best?.score ?? played.score, mover),
    evalAfter: playedWhite,
    insights,
    principles: dedupe(principles),
    threats: threats.length ? dedupe(threats).slice(0, 3) : undefined,
    betterIdea,
  };
}

function pos2name(pos: Position, sq: number): string {
  return `${PIECE_NAME[typeOf(pos.board[sq])]} on ${algebraic(sq)}`;
}

function collectThreats(posAfter: Position, mover: Color, threats: string[]) {
  // Pretend it's the mover's move again to see what they're threatening to win.
  const probe = new Position(posAfter.toState());
  (probe as any).turn = mover;
  let bestGain = 0; let bestSq = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = probe.board[sq];
    if (p === 0 || colorOf(p) === mover) continue;
    if (probe.attackersOf(sq, mover).length === 0) continue;
    const g = see(probe, sq, mover);
    if (g > bestGain) { bestGain = g; bestSq = sq; }
  }
  if (bestGain >= 120 && bestSq >= 0) {
    const t = `Threatens to win the ${pos2name(probe, bestSq)} (${algebraic(bestSq)}).`;
    if (!threats.includes(t)) threats.push(t);
  }
}

function reasonFor(before: ChessState, m: ChessMove): string {
  const pos = new Position(before);
  if (m.castle) return 'it castles the king to safety';
  if (m.capture && see(pos, m.to, before.turn as Color) > 50) return 'it wins material cleanly';
  const t = typeOf(m.piece);
  if (t === KNIGHT || t === BISHOP) return 'it develops a piece toward the centre';
  if (t === PAWN && isCenter(m.to)) return 'it fights for the centre';
  return 'it keeps the position sound';
}

function makeSummary(ctx: {
  isMate: boolean; oppInCheck: boolean; sacrifice: boolean;
  targets: number[]; move: ChessMove; movedName: string; insights: MoveInsight[];
}): string {
  const san = ctx.move.notation;
  if (ctx.isMate) return `${san} — checkmate! The king cannot escape.`;
  if (ctx.targets.length >= 2) return `${san} forks two pieces — a winning double attack.`;
  if (ctx.sacrifice) return `${san} sacrifices material for the initiative.`;
  const lead = ctx.insights.find((i) => i.tone === 'good') ?? ctx.insights[0];
  if (ctx.oppInCheck) return `${san}+ gives check and ${lead ? lead.tag.toLowerCase() : 'presses the attack'}.`;
  if (lead) return `${san} — ${lead.detail}`;
  return `${san} is played.`;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/* ------------------------------- Hint --------------------------------- */

/** Format a SAN line with move numbers, e.g. "12.Nf3 Nc6 13.Bb5". */
function formatLine(sans: string[], whiteToMove: boolean, startNum: number): string {
  const parts: string[] = [];
  let num = startNum;
  let white = whiteToMove;
  for (let i = 0; i < sans.length; i++) {
    if (white) parts.push(`${num}.${sans[i]}`);
    else { parts.push(i === 0 ? `${num}…${sans[i]}` : sans[i]); num++; }
    white = !white;
  }
  return parts.join(' ');
}

export function chessHint(state: ChessState): { move: ChessMove; text: string } | null {
  const out = analyze(state, 4, 700);
  if (!out.best) return null;
  const mover = state.turn as Color;
  const pos = new Position(state);
  const m = out.best;
  m.notation = pos.toSAN(m);
  const after = new Position(state);
  after.make(m);

  let text: string;
  if (after.inCheck((mover ^ 1) as Color) && after.legalMoves().length === 0) {
    text = `${m.notation} is checkmate — play it!`;
  } else if (m.capture && see(pos, m.to, mover) > 80) {
    text = `${m.notation} wins material — capture and come out ahead.`;
  } else {
    const fk = forkTargets(after, m.to, mover);
    if (fk.length >= 2) text = `${m.notation} sets up a fork on two pieces.`;
    else if (m.castle) text = `${m.notation} — castle now to get your king safe.`;
    else if (typeOf(m.piece) === KNIGHT || typeOf(m.piece) === BISHOP) text = `${m.notation} develops a piece and improves your position.`;
    else text = `${m.notation} is the engine's top choice here.`;
  }

  // Append the engine's principal variation so the learner sees the whole plan.
  if (out.pv && out.pv.length > 1) {
    text += `  Engine line: ${formatLine(out.pv, state.turn === 0, state.full)}`;
  }
  return { move: m, text };
}

export { MATE };
export type { Player };
