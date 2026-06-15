import { useMemo, useState } from 'react';
import type { GameDefinition, GameStatus, MoveBase, Player, TutorialChallenge } from '../engine/types';
import type { BoardTheme } from '../themes/boardThemes';
import { resolveClick } from '../engine/interaction';
import Board2D from './Board2D';
import './InteractiveLesson.css';

interface Props {
  def: GameDefinition;
  challenge: TutorialChallenge;
  setup?: string;
  theme: BoardTheme;
  onSolved?: () => void;
  onFailed?: () => void;
}

const norm = (s: string) => s.replace(/[+#]/g, '').replace(/\s+/g, '').toLowerCase();

interface LocalState {
  state: any;
  selected: number | null;
  targets: MoveBase[];
  lastMove: { from?: number; to: number; affected?: number[] } | null;
}

export default function InteractiveLesson({ def, challenge, setup, theme, onSolved, onFailed }: Props) {
  const initial = useMemo(() => {
    try { return setup ? def.deserialize(setup) : def.createInitialState(); }
    catch { return def.createInitialState(); }
  }, [def, setup]);

  const [ls, setLs] = useState<LocalState>({ state: initial, selected: null, targets: [], lastMove: null });
  const [result, setResult] = useState<'idle' | 'correct' | 'wrong'>('idle');
  const [feedback, setFeedback] = useState('');
  const solutions = useMemo(() => challenge.solution.map(norm), [challenge.solution]);
  const flipped = def.getTurn(initial) === 1;

  const reset = () => { setLs({ state: initial, selected: null, targets: [], lastMove: null }); setResult('idle'); setFeedback(''); };

  const tryMove = (move: MoveBase, fromState: any) => {
    const after = def.applyMove(fromState, move);
    const correct = solutions.includes(norm(move.notation));
    setLs({ state: after, selected: null, targets: [], lastMove: { from: (move as any).from, to: move.to, affected: (move as any).affected } });
    if (correct) {
      setResult('correct');
      setFeedback(challenge.success || 'Correct — that’s the move! ✓');
      onSolved?.();
    } else {
      setResult('wrong');
      setFeedback(`${move.notation} isn’t the strongest here. Reset and look for a stronger idea.`);
      onFailed?.();
    }
  };

  const onCell = (cell: number) => {
    if (result === 'correct' || result === 'wrong') return; // locked until reset
    const r = resolveClick(def, ls.state, ls.selected, ls.targets, cell);
    switch (r.kind) {
      case 'select': setLs((p) => ({ ...p, selected: r.cell, targets: r.targets })); break;
      case 'clear': setLs((p) => ({ ...p, selected: null, targets: [] })); break;
      case 'play': tryMove(r.move, ls.state); break;
      case 'promote': {
        const pick = r.options.find((o) => solutions.includes(norm(o.notation))) ?? r.options[0];
        tryMove(pick, ls.state);
        break;
      }
      case 'none': break;
    }
  };

  const status: GameStatus = def.getStatus(ls.state);

  return (
    <div className="lesson-interactive">
      <div className={`challenge-prompt ${result}`}>
        <span className="cp-icon">{result === 'correct' ? '✅' : result === 'wrong' ? '↻' : '🧩'}</span>
        <span>{result === 'idle' ? challenge.prompt : feedback}</span>
      </div>
      <div className="lesson-board interactive">
        <Board2D
          def={def}
          view={def.getBoardView(ls.state)}
          theme={theme}
          turn={def.getTurn(ls.state) as Player}
          flipped={flipped}
          selected={ls.selected}
          targets={ls.targets}
          lastMove={ls.lastMove}
          status={status}
          hint={null}
          onCell={onCell}
        />
      </div>
      {result !== 'idle' && (
        <button className="btn sm" onClick={reset}>↺ Try again</button>
      )}
    </div>
  );
}
