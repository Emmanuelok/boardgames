import type { Tutorial } from '../../engine/types';
import { parseSquare as S } from './engine';

const A = (from: string, to: string, tone: 'good' | 'bad' | 'info' = 'info') => ({ from: S(from), to: S(to), tone });

/**
 * A classical, in-depth course on chess — from the very rules to tactics and
 * endgames. Each step can carry an illustrative FEN position plus highlighted
 * squares and arrows, rendered on a mini board in the tutorial reader.
 */
const tutorial: Tutorial = {
  overview:
    'Chess is the great game of the mind — two armies, perfect information, and limitless depth. This course takes you from never having moved a piece to understanding development, tactics and basic checkmates, the same ideas our AI tutor will reinforce on every single move you play.',
  objective:
    'Checkmate your opponent\'s king: attack it so that it cannot escape, block the attack, or capture the attacker. The king is never actually taken — trapping it ends the game.',
  chapters: [
    {
      title: 'The Board & The Goal', icon: '📜',
      steps: [
        {
          title: 'An 8×8 battlefield',
          body: 'Chess is played on a board of 64 squares, alternating light and dark, 8 files (columns **a–h**) by 8 ranks (rows **1–8**). White sits at the bottom (ranks 1–2), Black at the top (ranks 7–8). A light square is always on each player\'s right.',
          setup: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        },
        {
          title: 'The starting army',
          body: 'Each side has 16 pieces: 8 **pawns** in front, then **rooks** in the corners, **knights** beside them, **bishops** next, and the **queen** and **king** in the middle. Remember: the queen starts on her own colour (white queen on a light square, d1).',
          setup: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          highlight: [S('d1'), S('d8')],
        },
        {
          title: 'White moves first',
          body: 'White always makes the first move, then players alternate, one move at a time. You may never skip a turn. Control of the initiative — making threats your opponent must answer — is a real advantage.',
        },
      ],
    },
    {
      title: 'How the Pieces Move', icon: '♟️',
      steps: [
        {
          title: 'The pawn',
          body: 'Pawns move straight **forward** one square — or two squares from their starting position — but **capture diagonally** forward. They can never move backward. Quiet but cunning, pawns shape the whole battle.',
          setup: '8/8/8/8/4p3/8/4P3/8 w - - 0 1',
          highlight: [S('e2')],
          arrows: [A('e2', 'e3'), A('e2', 'e4')],
        },
        {
          title: 'The knight',
          body: 'The knight moves in an **L-shape**: two squares one way and one square perpendicular. It is the only piece that **jumps over** others, which makes it deadly in crowded positions. From the centre it reaches up to eight squares.',
          setup: '8/8/8/8/3N4/8/8/8 w - - 0 1',
          highlight: [S('d4')],
          arrows: [A('d4', 'e6'), A('d4', 'f5'), A('d4', 'f3'), A('d4', 'e2'), A('d4', 'c2'), A('d4', 'b3'), A('d4', 'b5'), A('d4', 'c6')],
        },
        {
          title: 'The bishop',
          body: 'The bishop slides any number of squares **diagonally**. Each bishop stays on one colour forever, so the two together cover the whole board. Bishops love open, long diagonals.',
          setup: '8/8/8/8/3B4/8/8/8 w - - 0 1',
          highlight: [S('d4')],
          arrows: [A('d4', 'a7'), A('d4', 'g7'), A('d4', 'a1'), A('d4', 'h8'), A('d4', 'g1')],
        },
        {
          title: 'The rook',
          body: 'The rook slides any number of squares **horizontally or vertically**. Rooks are powerful in the endgame and on open files (columns with no pawns). Two connected rooks are a battering ram.',
          setup: '8/8/8/8/3R4/8/8/8 w - - 0 1',
          highlight: [S('d4')],
          arrows: [A('d4', 'd8'), A('d4', 'd1'), A('d4', 'a4'), A('d4', 'h4')],
        },
        {
          title: 'The queen',
          body: 'The queen combines rook and bishop: she moves any number of squares in **any straight line** — horizontal, vertical, or diagonal. She is the most powerful piece, worth about nine pawns. Bring her out too early, though, and she becomes a target.',
          setup: '8/8/8/8/3Q4/8/8/8 w - - 0 1',
          highlight: [S('d4')],
          arrows: [A('d4', 'd8'), A('d4', 'h4'), A('d4', 'a7'), A('d4', 'h8'), A('d4', 'a1'), A('d4', 'g1')],
        },
        {
          title: 'The king',
          body: 'The king moves **one square in any direction**. He is priceless — if he can\'t escape attack, the game is over — yet in the endgame he becomes a strong fighting piece. Keep him safe early, activate him late.',
          setup: '8/8/8/8/3K4/8/8/8 w - - 0 1',
          highlight: [S('d4')],
          arrows: [A('d4', 'd5'), A('d4', 'e5'), A('d4', 'e4'), A('d4', 'e3'), A('d4', 'd3'), A('d4', 'c3'), A('d4', 'c4'), A('d4', 'c5')],
        },
        {
          title: 'What each piece is worth',
          body: 'A handy scale: **pawn = 1**, **knight = 3**, **bishop = 3**, **rook = 5**, **queen = 9**. The king is infinite. Use these values to judge trades — giving a rook (5) for a bishop (3) usually loses material. Our tutor measures exactly this on every move.',
        },
      ],
    },
    {
      title: 'Special Moves', icon: '✨',
      steps: [
        {
          title: 'Castling',
          body: 'Once per game, if neither the king nor that rook has moved and the squares between are empty (and the king isn\'t moving through check), the king slides **two squares toward a rook** and the rook hops to the king\'s other side. It tucks your king away and activates a rook — do it early!',
          setup: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
          highlight: [S('e1'), S('h1'), S('a1')],
          arrows: [A('e1', 'g1', 'good'), A('e1', 'c1', 'good')],
        },
        {
          title: 'En passant',
          body: 'If an enemy pawn dashes two squares to land **beside** yours, you may capture it "in passing" exactly as if it had moved only one square — but only on the very next move. Here White\'s e5 pawn captures the black d-pawn, landing on d6.',
          setup: '8/8/8/3pP3/8/8/8/8 w - d6 0 1',
          highlight: [S('e5'), S('d5')],
          arrows: [A('e5', 'd6', 'good')],
        },
        {
          title: 'Promotion',
          body: 'A pawn that reaches the far end of the board **transforms** into a queen, rook, bishop, or knight (your choice — almost always a queen). A single pawn can become a second queen and decide the game.',
          setup: '8/4P3/8/8/8/8/8/8 w - - 0 1',
          highlight: [S('e7')],
          arrows: [A('e7', 'e8', 'good')],
        },
      ],
    },
    {
      title: 'Check, Checkmate & Draws', icon: '👑',
      steps: [
        {
          title: 'Check',
          body: 'When the king is attacked, it is **in check**. You must respond immediately by one of three means: **move** the king, **block** the attack, or **capture** the attacker. You may never leave or place your own king in check.',
        },
        {
          title: 'Checkmate — the goal',
          body: 'If a king is in check and there is **no legal way out**, that is **checkmate** and the game ends instantly. Here the rook delivers a back-rank mate: the black king is hemmed in by its own pawns.',
          setup: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
          arrows: [A('a1', 'a8', 'good')],
        },
        {
          title: 'Stalemate — a saving draw',
          body: 'If the player to move has **no legal move but is *not* in check**, the game is a **stalemate** — a draw. This is the great escape for the losing side, and a trap for the careless winner: don\'t take every pawn if it leaves the enemy king frozen.',
        },
        {
          title: 'Other draws',
          body: 'Games are also drawn by **agreement**, **threefold repetition** of the same position, the **fifty-move rule** (50 moves with no capture or pawn move), or **insufficient material** (e.g. king vs king). A draw scores half a point to each side.',
        },
      ],
    },
    {
      title: 'Opening Principles', icon: '🚀',
      steps: [
        {
          title: 'Control the centre',
          body: 'The four central squares (d4, e4, d5, e5) are the high ground. Pawns and pieces in the centre control more of the board and move faster to either wing. Classic first moves like **1.e4** or **1.d4** stake this claim.',
          setup: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
          highlight: [S('d4'), S('e4'), S('d5'), S('e5')],
        },
        {
          title: 'Develop your pieces',
          body: 'Bring your knights and bishops off the back rank toward the centre, ideally a new piece every move. Knights before bishops, and don\'t move the same piece twice without reason. Lagging in development invites disaster.',
          setup: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
          highlight: [S('f3'), S('c6')],
        },
        {
          title: 'King safety: castle',
          body: 'Get your king to safety by **castling** — usually on the kingside — within the first ten moves. A king caught in the centre as the position opens is the most common cause of a quick loss.',
        },
        {
          title: "Don't rush the queen",
          body: 'It is tempting to bring the queen out to attack early, but she is easily chased by minor pieces, losing you time (tempo) while your opponent develops. Develop the small pieces first; the queen joins later.',
        },
      ],
    },
    {
      title: 'Tactics — Winning Material', icon: '⚡',
      steps: [
        {
          title: 'The fork',
          body: 'A **fork** is a single piece attacking two (or more) targets at once. The knight is the master forker. Here the knight on c7 attacks the king on e8 *and* the rook on a8 — a "royal fork". The king must move, and the rook falls.',
          setup: 'r3k3/2N5/8/8/8/8/8/4K3 w - - 0 1',
          highlight: [S('c7'), S('a8'), S('e8')],
          arrows: [A('c7', 'e8', 'good'), A('c7', 'a8', 'good')],
        },
        {
          title: 'The pin',
          body: 'A **pin** freezes a piece because moving it would expose a more valuable one behind. The bishop on b4 pins the knight on d2 against the king on e1 — the knight cannot legally move. Pile up on a pinned piece to win it.',
          setup: '4k3/8/8/8/1b6/8/3N4/4K3 w - - 0 1',
          highlight: [S('b4'), S('d2'), S('e1')],
          arrows: [A('b4', 'e1', 'bad')],
        },
        {
          title: 'The skewer',
          body: 'A **skewer** is a pin in reverse: the valuable piece is in front and, when it moves aside, the piece behind it is captured. Rooks, bishops and queens deliver skewers along open lines.',
        },
        {
          title: 'The discovered attack',
          body: 'Moving one piece can **unveil** an attack from another behind it. When the moving piece *also* gives check (a discovered check), the effect is devastating — you can grab material with check that the opponent is helpless to prevent.',
        },
        {
          title: 'How the tutor helps',
          body: 'Every time you move, our AI tutor checks for exactly these patterns — forks, pins, hanging pieces, good and bad trades — grades your move from **Brilliant** to **Blunder**, and shows you the stronger idea when you miss one. Tactics are learned by repetition; this is your trainer.',
        },
      ],
    },
    {
      title: 'Basic Checkmates', icon: '🏁',
      steps: [
        {
          title: 'Two rooks: the ladder',
          body: 'With two rooks you mate by "walking a ladder": one rook cuts off a rank while the other checks, then they alternate, driving the lone king to the edge and mating. A perfect first checkmate to learn.',
          setup: '4k3/8/8/8/8/8/R7/1R2K3 w - - 0 1',
        },
        {
          title: 'Queen & king',
          body: 'The queen and king team up to mate a lone king at the edge. Use the queen a knight\'s-move away to herd the king to the rim — but mind **stalemate**: always leave the king a square until the final mating move.',
          setup: '4k3/8/4K3/4Q3/8/8/8/8 w - - 0 1',
        },
        {
          title: 'The opposition',
          body: 'In king-and-pawn endings, the **opposition** — standing your king directly in front of the enemy king with one square between — forces it to give ground. This single idea wins or draws countless endgames.',
          setup: '8/8/8/3k4/8/3K4/8/8 w - - 0 1',
          highlight: [S('d5'), S('d3')],
        },
        {
          title: 'Keep learning',
          body: 'You now know how every piece moves, the special rules, the opening principles, the core tactics and basic mates. Play games against the AI at rising difficulty, read the tutor on every move, and your strength will climb quickly. Good luck!',
        },
      ],
    },
  ],
};

export default tutorial;
