/**
 * A compact opening book. Rather than hand-encoding FEN keys (error-prone), we
 * declare famous opening lines as readable SAN sequences and replay them from
 * the start position to compute each position key. This gives the AI varied,
 * principled opening play for the first handful of moves.
 */
import { Position, initialState, applyChessMove, type ChessState } from './engine';

const LINES: string[][] = [
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'], // Ruy Lopez
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'],                            // Berlin Defence
  ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd3'],         // Italian Game
  ['e4', 'e5', 'Nf3', 'Nc6', 'd4', 'exd4', 'Nxd4', 'Nf6'],             // Scotch
  ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], // Najdorf Sicilian
  ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6'],              // Accelerated Dragon
  ['e4', 'c5', 'Nc3', 'Nc6', 'g3'],                                    // Closed Sicilian
  ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7'],               // French Defence
  ['e4', 'c6', 'd4', 'd5', 'Nc3', 'dxe4', 'Nxe4', 'Bf5'],             // Caro-Kann
  ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6'],           // Scandinavian
  ['e4', 'g6', 'd4', 'Bg7', 'Nc3', 'd6', 'f4'],                       // Modern / Pirc
  ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7'],              // Queen's Gambit Declined
  ['d4', 'd5', 'c4', 'dxc4', 'Nf3', 'Nf6', 'e3', 'e6'],             // Queen's Gambit Accepted
  ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6'],             // Slav Defence
  ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'Bg7', 'e4', 'd6', 'Nf3'],     // King's Indian Defence
  ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6', 'g3', 'Bb7'],            // Queen's Indian
  ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'],                         // Nimzo-Indian
  ['d4', 'f5', 'g3', 'Nf6', 'Bg2', 'e6'],                          // Dutch Defence
  ['c4', 'e5', 'Nc3', 'Nf6', 'Nf3', 'Nc6', 'g3'],                 // English Opening
  ['c4', 'c5', 'Nf3', 'Nf6', 'Nc3', 'Nc6'],                       // Symmetrical English
  ['Nf3', 'd5', 'd4', 'Nf6', 'c4', 'e6', 'Nc3'],                  // Reti into QGD
  ['Nf3', 'Nf6', 'g3', 'g6', 'Bg2', 'Bg7'],                       // Double Fianchetto
];

export function positionKey(state: ChessState): string {
  const fen = new Position(state).fen();
  return fen.split(' ').slice(0, 4).join(' ');
}

export const OPENING_BOOK: Record<string, string[]> = {};

(function build() {
  for (const line of LINES) {
    let state = initialState();
    for (const san of line) {
      const key = positionKey(state);
      const pos = new Position(state);
      const moves = pos.legalMoves();
      const m = moves.find((mv) => pos.toSAN(mv).replace(/[+#]/g, '') === san);
      if (!m) break; // malformed line; stop extending it
      (OPENING_BOOK[key] ||= []).push(san);
      state = applyChessMove(state, m);
    }
  }
  for (const k in OPENING_BOOK) OPENING_BOOK[k] = [...new Set(OPENING_BOOK[k])];
})();
