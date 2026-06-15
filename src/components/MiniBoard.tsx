import { useMemo } from 'react';
import type { GameDefinition } from '../engine/types';
import type { BoardTheme } from '../themes/boardThemes';
import { pieceStyleFor } from './pieceStyle';
import './Board2D.css';
import './MiniBoard.css';

interface Props {
  def: GameDefinition;
  setup?: string;
  highlight?: number[];
  arrows?: Array<{ from: number; to: number; tone?: 'good' | 'bad' | 'info' }>;
  theme: BoardTheme;
}

const TONE: Record<string, string> = { good: '#34d399', bad: '#f87171', info: '#c4b5fd' };

export default function MiniBoard({ def, setup, highlight = [], arrows = [], theme }: Props) {
  const state = useMemo(() => {
    try { return setup ? def.deserialize(setup) : def.createInitialState(); }
    catch { return def.createInitialState(); }
  }, [def, setup]);

  const view = def.getBoardView(state);
  const { rows, cols } = view;
  const style = def.render.pieceStyle;
  const checkered = def.render.checkered;
  const intersections = !!def.render.intersections;
  const hi = new Set(highlight);

  const pieceColor = (player: 0 | 1) =>
    style === 'chess' || style === 'stone'
      ? (player === 0 ? theme.pieceLight : theme.pieceDark)
      : def.players[player].color;

  const cx = (c: number) => c + 0.5;
  const cy = (r: number) => r + 0.5;

  return (
    <div className="board-wrap">
      <div
        className={`board mini ${theme.glass ? 'glassy' : ''}`}
        style={{
          aspectRatio: `${cols} / ${rows}`,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          background: theme.surface,
          borderColor: theme.border,
        }}
      >
        {def.render.connections ? (
          <svg className="grid-lines" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
            {def.render.connections.map(([a, b], i) => (
              <line key={i}
                x1={(a % cols) + 0.5} y1={Math.floor(a / cols) + 0.5}
                x2={(b % cols) + 0.5} y2={Math.floor(b / cols) + 0.5}
                stroke={theme.grid} strokeWidth={0.05} strokeLinecap="round" />
            ))}
          </svg>
        ) : (intersections || !checkered) && (
          <svg className="grid-lines" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
            {Array.from({ length: intersections ? cols : cols + 1 }).map((_, i) => {
              const x = intersections ? i + 0.5 : i;
              return <line key={'v' + i} x1={x} y1={intersections ? 0.5 : 0} x2={x} y2={intersections ? rows - 0.5 : rows} stroke={theme.grid} strokeWidth={0.03} />;
            })}
            {Array.from({ length: intersections ? rows : rows + 1 }).map((_, i) => {
              const y = intersections ? i + 0.5 : i;
              return <line key={'h' + i} x1={intersections ? 0.5 : 0} y1={y} x2={intersections ? cols - 0.5 : cols} y2={y} stroke={theme.grid} strokeWidth={0.03} />;
            })}
          </svg>
        )}
        {view.cells.map((cell) => {
          const isDark = (cell.row + cell.col) % 2 === 1;
          const sqColor = checkered ? (isDark ? theme.dark : theme.light) : 'transparent';
          return (
            <div
              key={cell.index}
              className="cell"
              style={{ gridColumn: cell.col + 1, gridRow: cell.row + 1, background: sqColor }}
            >
              {hi.has(cell.index) && <div className="hl mini-hi" />}
              {cell.count !== undefined && (
                <div className="pit">
                  <span className="pit-num">{cell.count}</span>
                </div>
              )}
              {cell.piece && (
                <div className={`pc ${style}`} style={pieceStyleFor(style, cell.piece.player, pieceColor(cell.piece.player))}>
                  {(style === 'chess' || style === 'mark' || style === 'xiangqi') && <span className="glyph">{cell.piece.glyph}</span>}
                  {cell.piece.crowned && <span className="crown">♛</span>}
                </div>
              )}
            </div>
          );
        })}

        {arrows.length > 0 && (
          <svg className="arrows" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
            <defs>
              {Object.entries(TONE).map(([k, c]) => (
                <marker key={k} id={`ah-${k}`} markerWidth="4" markerHeight="4" refX="2.4" refY="2" orient="auto">
                  <path d="M0,0 L4,2 L0,4 Z" fill={c} />
                </marker>
              ))}
            </defs>
            {arrows.map((a, i) => {
              const tone = a.tone ?? 'info';
              const fr = Math.floor(a.from / cols), fc = a.from % cols;
              const tr = Math.floor(a.to / cols), tc = a.to % cols;
              return (
                <line
                  key={i}
                  x1={cx(fc)} y1={cy(fr)} x2={cx(tc)} y2={cy(tr)}
                  stroke={TONE[tone]} strokeWidth={0.1} strokeLinecap="round"
                  markerEnd={`url(#ah-${tone})`} opacity={0.92}
                />
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
