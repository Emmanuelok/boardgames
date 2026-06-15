/**
 * Opening recognition for the tutor. Given the moves played from the start
 * (in SAN), we find the deepest named opening whose line is a prefix of the
 * game. This lets the tutor say "📖 Sicilian Defense: Najdorf Variation" and
 * explain the idea — the kind of classical, educational context the center is
 * built around. The list is curated (not exhaustive ECO) but covers the major
 * openings and their main variations to a useful depth.
 */

export interface OpeningInfo {
  eco: string;
  name: string;
  moves: string[]; // SAN from the initial position
  idea?: string; // one-line teaching note
}

// Ordered loosely from broad systems to specific variations; the matcher picks
// the longest matching prefix regardless of order.
const OPENINGS: OpeningInfo[] = [
  // ---- 1.e4 ----
  { eco: 'B00', name: "King's Pawn Opening", moves: ['e4'], idea: 'Stake a claim in the centre and free the bishop and queen.' },
  { eco: 'C20', name: "King's Pawn Game", moves: ['e4', 'e5'], idea: 'The classical, symmetrical reply — both sides fight for d4/f4 and rapid development.' },
  { eco: 'C40', name: "King's Knight Opening", moves: ['e4', 'e5', 'Nf3'], idea: 'Develop with tempo by attacking the e5-pawn.' },
  { eco: 'C44', name: 'Ruy López / Italian Setup', moves: ['e4', 'e5', 'Nf3', 'Nc6'], idea: 'Defend e5 and develop; White now chooses Bb5 (Spanish) or Bc4 (Italian).' },
  { eco: 'C60', name: 'Ruy López (Spanish Opening)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], idea: 'Pressure the knight that guards e5 — the most classical battle for the centre.' },
  { eco: 'C65', name: 'Ruy López: Berlin Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'], idea: 'Counterattack e4 at once; famously solid, the "Berlin Wall".' },
  { eco: 'C68', name: 'Ruy López: Exchange Variation', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6'], idea: 'Trade on c6 to damage Black\'s pawns and play a long endgame.' },
  { eco: 'C78', name: 'Ruy López: Morphy Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], idea: 'Question the bishop; after Ba4 Black gains space with ...b5 and ...Bc5/...Be7.' },
  { eco: 'C50', name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'], idea: 'Aim the bishop at f7, the weakest square in Black\'s camp.' },
  { eco: 'C53', name: 'Italian Game: Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], idea: 'The "quiet game" — slow, classical build-up around the centre.' },
  { eco: 'C55', name: 'Italian Game: Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'], idea: 'Counterattack e4 and invite sharp play (the Fried Liver looms).' },
  { eco: 'C57', name: 'Italian: Fried Liver Attack', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6', 'Ng5', 'd5', 'exd5', 'Nxd5', 'Nxf7'], idea: 'A daring knight sacrifice dragging the black king into the open.' },
  { eco: 'C46', name: 'Three Knights / Scotch Setup', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3'], idea: 'Symmetrical development before committing the centre.' },
  { eco: 'C47', name: 'Four Knights Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Nc3', 'Nf6'], idea: 'Sound, symmetrical and classical — develop everything before striking.' },
  { eco: 'C44', name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'], idea: 'Open the centre immediately and seize space.' },
  { eco: 'C44', name: 'Ponziani Opening', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'c3'], idea: 'Prepare d4 with pawn support — an old, tricky try.' },
  { eco: 'C30', name: "King's Gambit", moves: ['e4', 'e5', 'f4'], idea: 'Sacrifice a pawn to rip open the f-file and seize the centre — romantic chess.' },
  { eco: 'C33', name: "King's Gambit Accepted", moves: ['e4', 'e5', 'f4', 'exf4'], idea: 'Grab the pawn; now White plays for rapid development and attack.' },
  { eco: 'C25', name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'], idea: 'Develop the knight first, keeping f4 ideas in reserve.' },
  { eco: 'C23', name: "Bishop's Opening", moves: ['e4', 'e5', 'Bc4'], idea: 'Target f7 early and keep the game flexible.' },
  { eco: 'C41', name: 'Philidor Defense', moves: ['e4', 'e5', 'Nf3', 'd6'], idea: 'Solid but passive — Black props up e5 and aims for a sturdy structure.' },
  { eco: 'C42', name: 'Petrov (Russian) Defense', moves: ['e4', 'e5', 'Nf3', 'Nf6'], idea: 'Counterattack rather than defend e5 — a rock-solid equalizer.' },

  // Sicilian
  { eco: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'], idea: 'The fighting reply: Black takes the centre asymmetrically and plays for a win.' },
  { eco: 'B27', name: 'Sicilian Defense', moves: ['e4', 'c5', 'Nf3'], idea: 'White develops and prepares d4 to open the centre.' },
  { eco: 'B70', name: 'Sicilian: Dragon Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'], idea: 'Fianchetto the bishop on g7 — opposite-side castling and razor-sharp play.' },
  { eco: 'B90', name: 'Sicilian: Najdorf Variation', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], idea: '...a6 controls b5 and prepares ...e5/...e6 — the most analysed opening in chess.' },
  { eco: 'B33', name: 'Sicilian: Sveshnikov-style', moves: ['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'e5'], idea: 'Black grabs the centre and accepts a d5-hole for active piece play.' },
  { eco: 'B23', name: 'Sicilian: Closed', moves: ['e4', 'c5', 'Nc3'], idea: 'Keep the centre closed and play with f4 and a kingside build-up.' },
  { eco: 'B22', name: 'Sicilian: Alapin Variation', moves: ['e4', 'c5', 'c3'], idea: 'Prepare d4 with c3 — a positional anti-Sicilian aiming for a big centre.' },

  // Other 1.e4 replies
  { eco: 'C00', name: 'French Defense', moves: ['e4', 'e6'], idea: 'Solid: prepare ...d5 to strike the centre, accepting a slightly cramped position.' },
  { eco: 'C02', name: 'French: Advance Variation', moves: ['e4', 'e6', 'd4', 'd5', 'e5'], idea: 'Gain space and lock the centre; Black undermines with ...c5 and ...f6.' },
  { eco: 'C10', name: 'French Defense', moves: ['e4', 'e6', 'd4', 'd5'], idea: 'The central tension defines French play — chains, breaks and the bad bishop.' },
  { eco: 'B10', name: 'Caro-Kann Defense', moves: ['e4', 'c6'], idea: 'Support ...d5 without blocking the light-squared bishop — solid and resilient.' },
  { eco: 'B12', name: 'Caro-Kann: Advance', moves: ['e4', 'c6', 'd4', 'd5', 'e5'], idea: 'Grab space; Black develops the bishop to f5 before ...e6.' },
  { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'], idea: 'Challenge e4 at once; after exd5 Black recaptures with the queen or a knight.' },
  { eco: 'B07', name: 'Pirc Defense', moves: ['e4', 'd6'], idea: 'Hypermodern: let White build a big centre, then strike it with pieces and ...e5/...c5.' },
  { eco: 'B06', name: 'Modern Defense', moves: ['e4', 'g6'], idea: 'Fianchetto first and counterattack the centre later — flexible and provocative.' },
  { eco: 'B02', name: "Alekhine's Defense", moves: ['e4', 'Nf6'], idea: 'Provoke White\'s pawns forward, then attack the overextended centre.' },
  { eco: 'B00', name: 'Nimzowitsch Defense', moves: ['e4', 'Nc6'], idea: 'An offbeat, piece-first approach to the centre.' },

  // ---- 1.d4 ----
  { eco: 'A40', name: "Queen's Pawn Opening", moves: ['d4'], idea: 'Claim the centre solidly; play often revolves around the c4/e4 breaks.' },
  { eco: 'D00', name: "Queen's Pawn Game", moves: ['d4', 'd5'], idea: 'Symmetrical and classical; White usually follows with c4.' },
  { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'], idea: 'Offer the c-pawn to deflect Black\'s d5 and dominate the centre.' },
  { eco: 'D20', name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'], idea: 'Take the pawn but concede the centre; White regains it with tempo.' },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'], idea: 'Rock-solid: hold d5 with the e-pawn and develop classically.' },
  { eco: 'D10', name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'], idea: 'Support d5 with the c-pawn, keeping the light bishop free.' },
  { eco: 'D43', name: 'Semi-Slav Defense', moves: ['d4', 'd5', 'c4', 'c6', 'Nf3', 'Nf6', 'Nc3', 'e6'], idea: 'Combine Slav and QGD ideas — rich, double-edged middlegames.' },
  { eco: 'E00', name: 'Catalan Opening', moves: ['d4', 'Nf6', 'c4', 'e6', 'g3'], idea: 'Fianchetto the bishop to bear down the long diagonal onto Black\'s queenside.' },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], idea: 'Pin the knight and fight for e4 with pieces — a top-class defense.' },
  { eco: 'E60', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'], idea: 'Cede the centre, fianchetto, then storm the kingside with ...e5/...f5.' },
  { eco: 'E12', name: "Queen's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'], idea: 'Control e4 from afar with ...Bb7 — a sound, flexible system.' },
  { eco: 'D70', name: 'Grünfeld Defense', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'], idea: 'Strike the centre with ...d5, then chip at White\'s big pawn centre.' },
  { eco: 'A45', name: 'Trompowsky Attack', moves: ['d4', 'Nf6', 'Bg5'], idea: 'Pin the knight early and sidestep mainstream theory.' },
  { eco: 'A56', name: 'Benoni Defense', moves: ['d4', 'Nf6', 'c4', 'c5'], idea: 'Unbalance the pawns for dynamic, asymmetrical counterplay.' },
  { eco: 'A57', name: 'Benko Gambit', moves: ['d4', 'Nf6', 'c4', 'c5', 'd5', 'b5'], idea: 'Sacrifice a wing pawn for lasting pressure down the a- and b-files.' },
  { eco: 'A80', name: 'Dutch Defense', moves: ['d4', 'f5'], idea: 'Grab kingside space and play for an attack, accepting some weakening.' },

  // ---- Other first moves ----
  { eco: 'A04', name: 'Réti Opening', moves: ['Nf3'], idea: 'Hypermodern: develop and target the centre with pieces and a later c4.' },
  { eco: 'A10', name: 'English Opening', moves: ['c4'], idea: 'A flank opening fighting for d5; flexible, often transposing.' },
  { eco: 'A10', name: 'English: Symmetrical', moves: ['c4', 'c5'], idea: 'Both sides mirror on the flank — a slow, manoeuvring battle.' },
  { eco: 'A02', name: "Bird's Opening", moves: ['f4'], idea: 'Grip e5 and play for a kingside attack (a reversed Dutch).' },
  { eco: 'A00', name: 'Larsen / Nimzo-Larsen Attack', moves: ['b3'], idea: 'Fianchetto the queen\'s bishop to fight for the long diagonal.' },
];

const clean = (s: string) => s.replace(/[+#!?]/g, '');

/** Deepest named opening whose line is a prefix of the moves played so far. */
export function identifyOpening(playedSan: string[]): OpeningInfo | null {
  if (!playedSan.length) return null;
  const norm = playedSan.map(clean);
  let best: OpeningInfo | null = null;
  for (const o of OPENINGS) {
    if (o.moves.length > norm.length) continue;
    let ok = true;
    for (let i = 0; i < o.moves.length; i++) {
      if (o.moves[i] !== norm[i]) { ok = false; break; }
    }
    if (ok && (!best || o.moves.length > best.moves.length)) best = o;
  }
  return best;
}
