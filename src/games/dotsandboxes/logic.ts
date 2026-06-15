/**
 * Dots and Boxes — self-contained rules + AI. On a grid of R×C boxes, players
 * take turns drawing one edge between adjacent dots. Completing the fourth side
 * of a box claims it AND grants another move. When every edge is drawn, whoever
 * owns more boxes wins. Pure logic, no I/O; nothing mutates its arguments.
 *
 * Edges are indexed in one array: the first H are horizontal, the rest vertical.
 *   horizontal edge (r,c): r in 0..R (rows of dots), c in 0..C-1  → idx = r*C + c
 *   vertical   edge (r,c): r in 0..R-1, c in 0..C (cols of dots)  → idx = H + r*(C+1) + c
 */

export type Player = 0 | 1;
export const R = 5, C = 5; // 5×5 = 25 boxes (odd → no draws)
const H = (R + 1) * C; // horizontal edge count
const V = R * (C + 1); // vertical edge count
export const EDGES = H + V;

export interface DbState {
  edges: boolean[]; // length EDGES; true = drawn
  owner: (Player | null)[]; // length R*C; box owner or null
  scores: [number, number];
  turn: Player;
}

export const hIdx = (r: number, c: number) => r * C + c;
export const vIdx = (r: number, c: number) => H + r * (C + 1) + c;
/** The four edge indices of box (r,c): [top, bottom, left, right]. */
export const boxEdges = (r: number, c: number) => [hIdx(r, c), hIdx(r + 1, c), vIdx(r, c), vIdx(r, c + 1)];

export function initialState(): DbState {
  return { edges: Array(EDGES).fill(false), owner: Array(R * C).fill(null), scores: [0, 0], turn: 0 };
}

const clone = (s: DbState): DbState => ({ edges: s.edges.slice(), owner: s.owner.slice(), scores: [s.scores[0], s.scores[1]], turn: s.turn });

export const legalEdges = (s: DbState): number[] => {
  const out: number[] = [];
  for (let i = 0; i < EDGES; i++) if (!s.edges[i]) out.push(i);
  return out;
};

/** Boxes (as [r,c]) touching an edge index. */
function boxesOf(edge: number): [number, number][] {
  const out: [number, number][] = [];
  if (edge < H) { // horizontal edge (r,c)
    const r = Math.floor(edge / C), c = edge % C;
    if (r - 1 >= 0) out.push([r - 1, c]);
    if (r < R) out.push([r, c]);
  } else {
    const e = edge - H;
    const r = Math.floor(e / (C + 1)), c = e % (C + 1);
    if (c - 1 >= 0) out.push([r, c - 1]);
    if (c < C) out.push([r, c]);
  }
  return out;
}

const sidesDrawn = (s: DbState, r: number, c: number) => boxEdges(r, c).reduce((n, e) => n + (s.edges[e] ? 1 : 0), 0);

/** Draw an edge. Completing boxes claims them and keeps the turn; else it passes. */
export function applyEdge(s: DbState, edge: number): DbState {
  const next = clone(s);
  if (next.edges[edge]) return next;
  next.edges[edge] = true;
  let completed = 0;
  for (const [r, c] of boxesOf(edge)) {
    if (next.owner[r * C + c] === null && sidesDrawn(next, r, c) === 4) {
      next.owner[r * C + c] = next.turn;
      next.scores[next.turn]++;
      completed++;
    }
  }
  if (completed === 0) next.turn = (next.turn ^ 1) as Player;
  return next;
}

export const isOver = (s: DbState) => s.scores[0] + s.scores[1] === R * C;
export function winner(s: DbState): Player | null {
  if (!isOver(s)) return null;
  return s.scores[0] > s.scores[1] ? 0 : 1; // 25 boxes → never tied
}

/* --------------------------------- AI --------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** An edge that completes a box right now (a free box to take). */
function freeEdge(s: DbState): number | null {
  for (const e of legalEdges(s)) {
    for (const [r, c] of boxesOf(e)) if (sidesDrawn(s, r, c) === 3) return e;
  }
  return null;
}

/** A "safe" edge: drawing it leaves no box on three sides (gives nothing away). */
function safeEdges(s: DbState): number[] {
  return legalEdges(s).filter((e) => {
    const after = applyEdge(s, e);
    // Did we hand the opponent any 3-sided box? (Ignore boxes we just completed.)
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (after.owner[r * C + c] === null && sidesDrawn(after, r, c) === 3) return false;
    }
    return true;
  });
}

/** Greedily take every free box from here; returns how many `for` the side on move gains. */
function greedyGain(s: DbState, forPlayer: Player): number {
  let cur = s, gained = 0, guard = 0;
  while (guard++ < EDGES) {
    const f = freeEdge(cur);
    if (f === null || cur.turn !== forPlayer) break;
    const before = cur.scores[forPlayer];
    cur = applyEdge(cur, f);
    gained += cur.scores[forPlayer] - before;
  }
  return gained;
}

export function chooseMove(s: DbState, difficulty: 'easy' | 'medium' | 'hard'): number {
  const rng = mulberry32((s.edges.filter(Boolean).length + s.turn + 7) * 2654435761);
  const legal = legalEdges(s);

  const free = freeEdge(s);
  if (free !== null) return free; // always take a free box (it grants another move)

  const safe = safeEdges(s);
  if (safe.length) {
    if (difficulty === 'easy') return safe[Math.floor(rng() * safe.length)];
    // Prefer safe edges; pick randomly among them (all are equally "safe").
    return safe[Math.floor(rng() * rng() * safe.length)];
  }

  // Forced to open a chain — give away the smallest one. Simulate the opponent
  // greedily eating the chain our move opens and minimise their gain.
  const opp = (s.turn ^ 1) as Player;
  let best = legal[0], bestLoss = Infinity;
  const order = difficulty === 'easy' ? [legal[Math.floor(rng() * legal.length)]] : legal;
  for (const e of order) {
    const loss = greedyGain(applyEdge(s, e), opp);
    if (loss < bestLoss) { bestLoss = loss; best = e; }
  }
  return best;
}

export function evaluate(s: DbState): number {
  return s.scores[0] - s.scores[1];
}

/* ----------------------------- coach commentary ----------------------------- */

/** Any un-owned box currently drawn on three sides (a free box waiting to be taken). */
export function hasOpenBox(s: DbState): boolean {
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    if (s.owner[r * C + c] === null && sidesDrawn(s, r, c) === 3) return true;
  }
  return false;
}

/** One-line commentary on the move that turned `before` into `after`. */
export function moveComment(before: DbState, _edge: number, after: DbState): { text: string; tone: 'good' | 'bad' | 'info' } {
  const who = before.turn;
  const name = who === 0 ? 'You' : 'Red';
  const gained = after.scores[who] - before.scores[who];
  if (gained > 0) {
    return { text: `${name} ${who === 0 ? 'complete' : 'completes'} ${gained} box${gained > 1 ? 'es' : ''} — ${who === 0 ? 'and go again!' : 'Red moves again.'}`, tone: who === 0 ? 'good' : 'bad' };
  }
  if (hasOpenBox(after)) {
    return { text: `${name} ${who === 0 ? 'drew' : 'draws'} a third side — that opens a box for ${who === 0 ? 'Red' : 'you'}.`, tone: who === 0 ? 'bad' : 'good' };
  }
  return { text: `${name} ${who === 0 ? 'played' : 'plays'} a safe line.`, tone: 'info' };
}

/** A strategy tip for the position the side to move faces. */
export function coachTip(s: DbState): string {
  if (isOver(s)) return s.scores[0] > s.scores[1] ? 'You took more boxes — well played!' : 'Red edged the box count this time.';
  if (hasOpenBox(s)) return s.turn === 0 ? 'There’s a free box on offer — take it, then look for a chain.' : 'Red has a free box to grab.';
  const safe = safeEdges(s).length;
  if (safe === 0) return 'No safe lines left — you must open a chain. Open the smallest one, and remember the double-cross.';
  if (safe <= 4) return 'Safe lines are running out. Try to make your opponent be the one forced to open a chain.';
  return 'Never draw the third side of a box. Play neutral lines and watch how the chains are forming.';
}
