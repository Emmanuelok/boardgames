import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { createElement as h } from 'react';
import App from '../src/App';
import Board2D from '../src/components/Board2D';
import MiniBoard from '../src/components/MiniBoard';
import { getGame, GAMES } from '../src/engine/registry';
import { getTheme } from '../src/themes/boardThemes';

let fail = 0;
function check(name: string, fn: () => string) {
  try {
    const html = fn();
    if (!html || html.length < 20) throw new Error('suspiciously short output');
    console.log(`  ✓ ${name} (${html.length} chars)`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${name}: ${(e as Error).message}\n${(e as Error).stack?.split('\n').slice(1, 4).join('\n')}`);
  }
}

console.log('SSR render smoke test:');

for (const route of ['/', '/learn/chess', '/learn/reversi', '/play/chess']) {
  check(`route ${route}`, () => renderToStaticMarkup(h(StaticRouter as any, { location: route }, h(App))));
}

const theme = getTheme('glass-crystal');
for (const def of GAMES) {
  const state = def.createInitialState();
  const view = def.getBoardView(state);
  check(`Board2D ${def.id}`, () =>
    renderToStaticMarkup(
      h(Board2D as any, {
        def, view, theme, turn: def.getTurn(state), flipped: false,
        selected: null, targets: def.getLegalMoves(state, null).slice(0, 3),
        lastMove: null, status: def.getStatus(state), hint: null, onCell: () => {},
      }),
    ));
}

// MiniBoard with a real chess tutorial FEN (fork position)
const chess = getGame('chess')!;
check('MiniBoard chess (fork FEN)', () =>
  renderToStaticMarkup(
    h(MiniBoard as any, {
      def: chess, setup: 'r3k3/2N5/8/8/8/8/8/4K3 w - - 0 1',
      highlight: [10, 0, 4], arrows: [{ from: 10, to: 4, tone: 'good' }], theme: getTheme('tournament-green'),
    }),
  ));

console.log(fail === 0 ? '\n✅ ALL SSR RENDERS OK' : `\n❌ ${fail} render failure(s)`);
