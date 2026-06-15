import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { BoardView, GameDefinition, GameStatus, MoveBase, Player } from '../engine/types';
import type { BoardTheme } from '../themes/boardThemes';
import { pieceStyleFor } from './pieceStyle';
import ChessPiece from './ChessPiece';
import './Board2D.css';

interface Props {
  def: GameDefinition;
  view: BoardView;
  theme: BoardTheme;
  turn: Player;
  flipped: boolean;
  selected: number | null;
  targets: MoveBase[];
  lastMove: { from?: number; to: number; affected?: number[] } | null;
  status: GameStatus;
  hint: MoveBase | null;
  onCell: (cell: number) => void;
}

export default function Board2D(props: Props) {
  const { def, view, theme, turn, flipped, selected, targets, lastMove, status, hint, onCell } = props;
  const { rows, cols } = view;
  const boardRef = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState(56);
  const [hoverCol, setHoverCol] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCellPx(el.clientWidth / cols));
    ro.observe(el);
    setCellPx(el.clientWidth / cols);
    return () => ro.disconnect();
  }, [cols]);

  const dRow = (r: number) => (flipped ? rows - 1 - r : r);
  const dCol = (c: number) => (flipped ? cols - 1 - c : c);

  const targetSet = new Map<number, MoveBase>();
  for (const m of targets) if (!targetSet.has(m.to)) targetSet.set(m.to, m);

  const style = def.render.pieceStyle;
  const intersections = !!def.render.intersections;
  const checkered = def.render.checkered;

  let checkSq = -1;
  if (status.kind === 'check') {
    const c = view.cells.find((cv) => cv.piece && cv.piece.kind === 'K' && cv.piece.player === status.player);
    if (c) checkSq = c.index;
  }

  let dropPreview = -1;
  if (def.interaction.type === 'drop' && hoverCol !== null) {
    const m = targets.find((mv) => mv.to % cols === hoverCol);
    if (m) dropPreview = m.to;
  }

  const pieceColor = (player: Player) =>
    style === 'chess' || style === 'stone'
      ? (player === 0 ? theme.pieceLight : theme.pieceDark)
      : def.players[player].color;

  return (
    <div className="board-wrap" style={{ ['--glow' as any]: theme.glow ?? 'transparent' }}>
      <div
        ref={boardRef}
        className={`board ${theme.glass ? 'glassy' : ''} ${intersections ? 'go' : ''}`}
        style={{
          aspectRatio: `${cols} / ${rows}`,
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`,
          background: theme.surface,
          borderColor: theme.border,
          boxShadow: theme.glow ? `0 0 50px -12px ${theme.glow}, var(--shadow)` : 'var(--shadow)',
        }}
        onMouseLeave={() => setHoverCol(null)}
      >
        {def.render.connections ? (
          <svg className="grid-lines" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none">
            {def.render.connections.map(([a, b], i) => (
              <line key={i}
                x1={dCol(a % cols) + 0.5} y1={dRow(Math.floor(a / cols)) + 0.5}
                x2={dCol(b % cols) + 0.5} y2={dRow(Math.floor(b / cols)) + 0.5}
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
          const r = dRow(cell.row);
          const c = dCol(cell.col);
          const isDark = (cell.row + cell.col) % 2 === 1;
          const target = targetSet.get(cell.index);
          const isSel = selected === cell.index;
          const isLast = !!lastMove && (lastMove.to === cell.index || lastMove.from === cell.index);
          const isCheck = checkSq === cell.index;
          const isHint = !!hint && (hint.to === cell.index || hint.from === cell.index);
          const sqColor = checkered ? (isDark ? theme.dark : theme.light) : 'transparent';
          const moved = cell.piece && lastMove && lastMove.to === cell.index && lastMove.from != null;
          const dx = moved ? (dCol((lastMove!.from as number) % cols) - c) * cellPx : 0;
          const dy = moved ? (dRow(Math.floor((lastMove!.from as number) / cols)) - r) * cellPx : 0;

          return (
            <div
              key={cell.index}
              className={`cell ${isDark ? 'dark' : 'light'} ${cell.playable === false ? 'void' : ''}`}
              style={{ gridColumn: c + 1, gridRow: r + 1, background: sqColor }}
              onClick={() => cell.playable !== false && onCell(cell.index)}
              onMouseEnter={() => def.interaction.type === 'drop' && setHoverCol(cell.col)}
            >
              {isLast && <div className="hl last" />}
              {isSel && <div className="hl sel" />}
              {isCheck && <div className="hl check" />}
              {isHint && <div className="hl hint" />}
              {def.render.connections && cell.playable !== false && !cell.piece && cell.count === undefined && (
                <div className="point" style={{ background: theme.grid }} />
              )}

              {cell.piece && (
                <motion.div
                  key={cell.piece.id}
                  className={`pc ${style}`}
                  initial={dx || dy ? { x: dx, y: dy } : { scale: 0.2, opacity: 0 }}
                  animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 700, damping: 42, mass: 0.6 }}
                  style={pieceStyleFor(style, cell.piece.player, pieceColor(cell.piece.player))}
                >
                  {style === 'chess'
                    ? <ChessPiece kind={cell.piece.kind} fill={pieceColor(cell.piece.player)} stroke={cell.piece.player === 0 ? '#3b3f4a' : '#05070c'} shine={cell.piece.player === 1 ? 'rgba(255,255,255,0.13)' : undefined} />
                    : (style === 'mark' || style === 'xiangqi') ? <span className="glyph">{cell.piece.glyph}</span> : null}
                  {cell.piece.crowned && <span className="crown">♛</span>}
                </motion.div>
              )}

              {cell.count !== undefined && (
                <div className="pit">
                  <div className="pit-stones">
                    {Array.from({ length: Math.min(cell.count, 14) }).map((_, i) => <span key={i} className="stone-dot" />)}
                  </div>
                  <span className="pit-num">{cell.count}</span>
                  {cell.label && <span className="pit-label">{cell.label}</span>}
                </div>
              )}

              {dropPreview === cell.index && (
                <div className="pc disc preview" style={pieceStyleFor('disc', turn, def.players[turn].color)} />
              )}

              {target && !cell.piece && <div className="dot" />}
              {target && cell.piece && <div className="capture-ring" />}

              <Coord cell={cell} view={view} flipped={flipped} rows={rows} cols={cols} show={def.render.showCoordinates} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Coord({ cell, view, flipped, rows, cols, show }: { cell: any; view: BoardView; flipped: boolean; rows: number; cols: number; show: boolean; }) {
  if (!show) return null;
  const lastDisplayRow = flipped ? cell.row === 0 : cell.row === rows - 1;
  const firstDisplayCol = flipped ? cell.col === cols - 1 : cell.col === 0;
  const file = view.fileLabels?.[cell.col] ?? String.fromCharCode(65 + cell.col);
  const rank = view.rankLabels?.[cell.row] ?? String(rows - cell.row);
  return (
    <>
      {lastDisplayRow && <span className="coord file">{file}</span>}
      {firstDisplayCol && <span className="coord rank">{rank}</span>}
    </>
  );
}
