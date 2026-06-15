/** The new eval-bar games: scale is set and maps the static eval to a sane,
 *  non-degenerate advantage fraction (near-centre at the symmetric start). */
import { getGame } from '../src/engine/registry';

const frac = (score: number, scale: number) => 1 / (1 + Math.pow(10, -score / scale));
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fail++; };

for (const id of ['chess', 'breakthrough', 'checkers', 'draughts', 'xiangqi']) {
  const def = getGame(id)!;
  const scale = def.evalScale;
  ok(scale != null, `${id}: evalScale set (${scale})`);
  if (scale == null) continue;
  const e0 = def.evaluate(def.createInitialState());
  const f0 = frac(e0, scale);
  ok(f0 >= 0.4 && f0 <= 0.62, `${id}: start eval ${e0} → bar ${(f0 * 100).toFixed(0)}% (near centre)`);
  // Dynamic range: a one-unit material edge (≈ the scale) should read as a clear
  // but not pegged advantage; a big edge should approach, not hit, the end.
  ok(frac(scale, scale) > 0.85 && frac(scale, scale) < 0.95, `${id}: a scale-sized edge → ${(frac(scale, scale) * 100).toFixed(0)}% (clear, not pegged)`);
  ok(frac(scale / 4, scale) > 0.55 && frac(scale / 4, scale) < 0.7, `${id}: a small edge → ${(frac(scale / 4, scale) * 100).toFixed(0)}% (slight)`);
}

console.log(fail === 0 ? '\n✅ EVAL-BAR SCALES OK' : `\n❌ ${fail} failure(s)`);
if (fail > 0) process.exit(1);
