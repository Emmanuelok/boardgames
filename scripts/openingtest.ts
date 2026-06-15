/** Opening recognition: known SAN sequences resolve to the right (deepest) name. */
import { identifyOpening } from '../src/games/chess/openings';

const cases: { san: string[]; expect: string }[] = [
  { san: ['e4'], expect: "King's Pawn Opening" },
  { san: ['e4', 'c5'], expect: 'Sicilian Defense' },
  { san: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'], expect: 'Sicilian: Najdorf Variation' },
  { san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'], expect: 'Ruy López (Spanish Opening)' },
  { san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], expect: 'Ruy López: Morphy Defense' },
  { san: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'], expect: 'Italian Game: Giuoco Piano' },
  { san: ['e4', 'e6'], expect: 'French Defense' },
  { san: ['e4', 'c6'], expect: 'Caro-Kann Defense' },
  { san: ['d4', 'd5', 'c4'], expect: "Queen's Gambit" },
  { san: ['d4', 'd5', 'c4', 'e6'], expect: "Queen's Gambit Declined" },
  { san: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'], expect: 'Nimzo-Indian Defense' },
  { san: ['d4', 'Nf6', 'c4', 'g6'], expect: "King's Indian Defense" },
  { san: ['c4'], expect: 'English Opening' },
  { san: ['Nf3'], expect: 'Réti Opening' },
  // deepest-prefix wins even with check symbols stripped
  { san: ['e4', 'e5', 'Nf3+', 'Nc6'], expect: 'Ruy López / Italian Setup' },
];

let fail = 0;
for (const c of cases) {
  const got = identifyOpening(c.san);
  const ok = got?.name === c.expect;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${c.san.join(' ')} → ${got?.name ?? 'none'}${ok ? '' : `  (expected ${c.expect})`}`);
}
// Out-of-book moves keep the last recognised name (chess.com behaviour).
const deep = identifyOpening(['e4', 'c5', 'Nf3', 'Nc6', 'd4', 'cxd4', 'Nxd4', 'g6', 'c4', 'Bg7', 'Be3']);
console.log(`  persists out of book: ${deep ? deep.name : 'none'}`);
const none = identifyOpening(['a3', 'h6']);
console.log(`  unknown line → ${none?.name ?? 'none (ok)'}`);

console.log(fail === 0 ? '\n✅ OPENING RECOGNITION OK' : `\n❌ ${fail} case(s) failed`);
if (fail > 0) process.exit(1);
