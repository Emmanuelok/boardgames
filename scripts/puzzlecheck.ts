import { GAMES } from '../src/engine/registry';

const norm = (s: string) => s.replace(/[+#]/g, '').replace(/\s+/g, '').toLowerCase();
let fail = 0;

for (const def of GAMES) {
  for (const ch of def.tutorial.chapters) {
    for (const step of ch.steps) {
      if (!step.challenge) continue;
      const state = step.setup ? def.deserialize(step.setup) : def.createInitialState();
      const legal = def.getLegalMoves(state, null);
      const sols = step.challenge.solution.map(norm);
      const match = legal.find((m) => sols.includes(norm(m.notation)));
      if (match) {
        console.log(`  ✓ [${def.id}] "${step.title}" → ${match.notation}`);
      } else {
        fail++;
        console.log(`  ✗ [${def.id}] "${step.title}" — no legal move matches ${JSON.stringify(step.challenge.solution)}; legal e.g. ${legal.slice(0, 6).map((m) => m.notation).join(', ')}`);
      }
    }
  }
}
console.log(fail === 0 ? '\n✅ ALL PUZZLES SOLVABLE' : `\n❌ ${fail} unsolvable puzzle(s)`);
