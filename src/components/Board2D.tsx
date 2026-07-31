import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  ACCESSIBILITY_EVENT,
  readAccessibilityPreferences,
  type MotionMode,
} from '../accessibility/preferences';
import type { BoardView, CellView, GameDefinition, GameStatus, MoveBase, Player } from '../engine/types';
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
  /** Amazons: the amazon's chosen destination during the shoot phase (extra highlight). */
  pendingCell?: number | null;
  /** Present the position without focus, keyboard, click, or drag controls. */
  readOnly?: boolean;
}

export default function Board2D(props: Props) {
  const {
    def, view, theme, turn, flipped, selected, targets, lastMove, status,
    hint, onCell, pendingCell, readOnly = false,
  } = props;
  const { rows, cols } = view;
  const { verboseBoardLabels, reducedMotion } = useBoardAccessibility();
  const boardRef = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState(56);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);

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

  // Drag-to-move: a normal click is activated only by `onClick`; the source is
  // selected from pointermove only after the drag threshold is crossed. Pointer
  // coordinates stay in this ref and the floating piece is painted at most once
  // per frame, so moving a pointer never re-renders the whole board.
  const dragRef = useRef<{
    pointerId: number;
    from: number;
    cell: CellView;
    sourceElement: HTMLDivElement;
    x0: number;
    y0: number;
    x: number;
    y: number;
    moved: boolean;
    sourceWasSelected: boolean;
    paintFrame: number | null;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);
  const onCellRef = useRef(onCell);
  onCellRef.current = onCell;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [dragCell, setDragCell] = useState<CellView | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);

  const paintGhost = (active: NonNullable<typeof dragRef.current>) => {
    if (active.paintFrame !== null) return;
    active.paintFrame = window.requestAnimationFrame(() => {
      active.paintFrame = null;
      if (dragRef.current !== active || !active.moved || !ghostRef.current) return;
      ghostRef.current.style.transform = `translate3d(${active.x}px, ${active.y}px, 0) translate(-50%, -50%) scale(1.06)`;
    });
  };

  const clearDrag = (releaseCapture = true) => {
    const active = dragRef.current;
    if (!active) return;
    dragRef.current = null;
    if (active.paintFrame !== null) window.cancelAnimationFrame(active.paintFrame);
    setDragCell(null);
    if (
      releaseCapture
      && typeof active.sourceElement.hasPointerCapture === 'function'
      && active.sourceElement.hasPointerCapture(active.pointerId)
    ) {
      try {
        active.sourceElement.releasePointerCapture(active.pointerId);
      } catch {
        // The browser may have released capture while dispatching pointerup.
      }
    }
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) {
        d.moved = true;
        if (!d.sourceWasSelected) onCellRef.current(d.from);
        setDragCell(d.cell);
      }
      if (d.moved) {
        e.preventDefault();
        paintGhost(d);
      }
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const moved = d.moved;
      const from = d.from;
      clearDrag();
      if (moved) {
        suppressClickRef.current = true;
        if (suppressClickTimerRef.current !== null) {
          window.clearTimeout(suppressClickTimerRef.current);
        }
        suppressClickTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = false;
          suppressClickTimerRef.current = null;
        }, 350);

        const cellElement = (
          document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
        )?.closest<HTMLElement>('[data-idx]');
        const rawIndex = cellElement?.dataset.idx;
        const idx = rawIndex !== undefined && /^\d+$/.test(rawIndex)
          ? Number(rawIndex)
          : -1;
        const isBoardCell = !!cellElement
          && !!boardRef.current
          && boardRef.current.contains(cellElement)
          && Number.isSafeInteger(idx);
        if (isBoardCell && idx !== from) onCellRef.current(idx);
      }
    };
    const cancel = (e: PointerEvent) => {
      if (dragRef.current?.pointerId !== e.pointerId) return;
      clearDrag(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      const active = dragRef.current;
      if (active && active.paintFrame !== null) {
        window.cancelAnimationFrame(active.paintFrame);
      }
      dragRef.current = null;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
        suppressClickTimerRef.current = null;
      }
    };
  }, []);

  useLayoutEffect(() => {
    const active = dragRef.current;
    if (dragCell && active?.moved) paintGhost(active);
  }, [dragCell]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>, cell: CellView) => {
    if (
      readOnly
      || dragRef.current
      || e.button !== 0
      || e.isPrimary === false
      || !cell.piece
      || cell.playable === false
      || cell.piece.player !== turn
    ) return;
    const sourceElement = e.currentTarget;
    dragRef.current = {
      pointerId: e.pointerId,
      from: cell.index,
      cell,
      sourceElement,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      sourceWasSelected: selectedRef.current === cell.index,
      paintFrame: null,
    };
    try {
      sourceElement.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is an enhancement; window listeners remain the fallback.
    }
  };

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

  // ── Keyboard navigation: a roving-tabindex grid. Arrow keys move a cursor in
  // visual (display) space, skipping unplayable squares; Enter/Space activates
  // the focused square via the same handler a click uses. ────────────────────
  const firstPlayable = view.cells.find((cv) => cv.playable !== false)?.index ?? -1;
  const cursorIdx = cursor != null && view.cells.some((cv) => cv.index === cursor && cv.playable !== false) ? cursor : firstPlayable;
  const displayMap = new Map<number, number>(); // display (r*cols+c) → cell index
  for (const cv of view.cells) if (cv.playable !== false) displayMap.set(dRow(cv.row) * cols + dCol(cv.col), cv.index);

  const PIECE_NAMES: Record<string, string> = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
  const cellLabel = (cell: CellView): string => {
    const file = view.fileLabels?.[cell.col] ?? String.fromCharCode(97 + cell.col);
    const rank = view.rankLabels?.[cell.row] ?? String(rows - cell.row);
    let contents = 'empty';
    if (cell.piece) contents = `${def.players[cell.piece.player].name} ${PIECE_NAMES[cell.piece.kind] ?? cell.piece.glyph ?? cell.piece.kind ?? 'piece'}`;
    else if (cell.count !== undefined) contents = `${cell.count} ${cell.label ?? 'pieces'}`;
    if (!verboseBoardLabels) return `${file}${rank}, ${contents === 'empty' ? 'empty' : 'occupied'}`;
    const states = [
      targetSet.has(cell.index) ? 'legal move' : '',
      selected === cell.index ? 'selected' : '',
      lastMove?.to === cell.index ? 'last move destination' : '',
      hint?.to === cell.index ? 'hint destination' : '',
    ].filter(Boolean);
    return `${file}${rank}, ${contents}${states.length ? `, ${states.join(', ')}` : ''}`;
  };
  const focusCell = (idx: number) => { (boardRef.current?.querySelector(`[data-idx="${idx}"]`) as HTMLElement | null)?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      if (cursorIdx >= 0) { e.preventDefault(); onCell(cursorIdx); }
      return;
    }
    const dir: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const d = dir[e.key];
    const cur = view.cells.find((cv) => cv.index === cursorIdx);
    if (!d || !cur) return;
    e.preventDefault();
    let r = dRow(cur.row), c = dCol(cur.col);
    for (let step = 0; step < Math.max(rows, cols); step++) {
      r += d[0]; c += d[1];
      if (r < 0 || r >= rows || c < 0 || c >= cols) return; // ran off the edge — stay put
      const next = displayMap.get(r * cols + c);
      if (next != null) { setCursor(next); focusCell(next); return; }
    }
  };

  return (
    <div className="board-wrap" style={{ ['--glow' as any]: theme.glow ?? 'transparent' }}>
      <div
        ref={boardRef}
        className={`board ${theme.glass ? 'glassy' : ''} ${intersections ? 'go' : ''} ${readOnly ? 'readonly' : ''}`}
        role="grid"
        aria-label={readOnly
          ? `${def.name} board, ${rows} by ${cols}. Read-only position.`
          : `${def.name} board, ${rows} by ${cols}. Use the arrow keys to move and Enter to select.`}
        aria-readonly={readOnly || undefined}
        aria-rowcount={rows}
        aria-colcount={cols}
        onKeyDown={readOnly ? undefined : onKeyDown}
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
              data-idx={cell.index}
              className={`cell ${isDark ? 'dark' : 'light'} ${cell.playable === false ? 'void' : ''}`}
              role={cell.playable !== false ? 'gridcell' : undefined}
              tabIndex={!readOnly && cell.playable !== false ? (cell.index === cursorIdx ? 0 : -1) : undefined}
              aria-label={cell.playable !== false ? cellLabel(cell) : undefined}
              aria-selected={isSel || undefined}
              aria-rowindex={cell.playable !== false ? r + 1 : undefined}
              aria-colindex={cell.playable !== false ? c + 1 : undefined}
              style={{ gridColumn: c + 1, gridRow: r + 1, background: sqColor, touchAction: 'none' }}
              onClick={() => {
                if (readOnly) return;
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  if (suppressClickTimerRef.current !== null) {
                    window.clearTimeout(suppressClickTimerRef.current);
                    suppressClickTimerRef.current = null;
                  }
                  return;
                }
                if (cell.playable !== false) { setCursor(cell.index); onCell(cell.index); }
              }}
              onPointerDown={(e) => startDrag(e, cell)}
              onLostPointerCapture={(e) => {
                if (dragRef.current?.pointerId === e.pointerId) clearDrag(false);
              }}
              onMouseEnter={() => def.interaction.type === 'drop' && setHoverCol(cell.col)}
            >
              {isLast && <div className="hl last" />}
              {isSel && <div className="hl sel" />}
              {pendingCell === cell.index && <div className="hl sel" />}
              {isCheck && <div className="hl check" />}
              {isHint && <div className="hl hint" />}
              {def.render.connections && cell.playable !== false && !cell.piece && cell.count === undefined && (
                <div className="point" style={{ background: theme.grid }} />
              )}
              {cell.mark && <div className={`cell-mark ${cell.mark}`} />}

              {cell.piece && (
                <PieceLayer
                  key={cell.piece.id}
                  className={`pc ${style}`}
                  player={cell.piece.player}
                  reducedMotion={reducedMotion}
                  offsetX={dx}
                  offsetY={dy}
                  dragged={dragCell?.index === cell.index}
                  style={pieceStyleFor(style, cell.piece.player, pieceColor(cell.piece.player))}
                >
                  {style === 'chess'
                    ? <ChessPiece kind={cell.piece.kind} fill={pieceColor(cell.piece.player)} stroke={cell.piece.player === 0 ? '#3b3f4a' : '#05070c'} shine={cell.piece.player === 1 ? 'rgba(255,255,255,0.13)' : undefined} />
                    : (style === 'mark' || style === 'xiangqi') ? <span className="glyph">{cell.piece.glyph}</span> : null}
                  {cell.piece.crowned && <span className="crown">♛</span>}
                </PieceLayer>
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

      {dragCell?.piece && createPortal(
        <div
          ref={ghostRef}
          className="drag-ghost"
          aria-hidden="true"
          style={{ width: cellPx, height: cellPx }}
        >
          <div className={`pc ${style}`} style={pieceStyleFor(style, dragCell.piece.player, pieceColor(dragCell.piece.player))}>
            {style === 'chess'
              ? <ChessPiece kind={dragCell.piece.kind} fill={pieceColor(dragCell.piece.player)} stroke={dragCell.piece.player === 0 ? '#3b3f4a' : '#05070c'} shine={dragCell.piece.player === 1 ? 'rgba(255,255,255,0.13)' : undefined} />
              : (style === 'mark' || style === 'xiangqi') ? <span className="glyph">{dragCell.piece.glyph}</span> : null}
            {dragCell.piece.crowned && <span className="crown">♛</span>}
          </div>
        </div>, document.body)}
    </div>
  );
}

function useBoardAccessibility(): { verboseBoardLabels: boolean; reducedMotion: boolean } {
  const read = () => {
    const preferences = readAccessibilityPreferences();
    const root = typeof document === 'undefined' ? undefined : document.documentElement;
    const verbose = root?.dataset.verboseBoardLabels === undefined
      ? preferences.verboseBoardLabels
      : root.dataset.verboseBoardLabels === 'true';
    const motionChoice = (root?.dataset.motion as MotionMode | undefined) ?? preferences.motion;
    const systemReduced = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return {
      verboseBoardLabels: verbose,
      reducedMotion: motionChoice === 'reduced' || (motionChoice === 'system' && systemReduced),
    };
  };
  const [options, setOptions] = useState(read);

  useEffect(() => {
    const update = () => setOptions(read());
    const media = typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    window.addEventListener(ACCESSIBILITY_EVENT, update);
    window.addEventListener('storage', update);
    media?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener(ACCESSIBILITY_EVENT, update);
      window.removeEventListener('storage', update);
      media?.removeEventListener?.('change', update);
    };
  }, []);

  return options;
}

function PieceLayer({
  children,
  className,
  player,
  reducedMotion,
  offsetX,
  offsetY,
  dragged,
  style,
}: {
  children: ReactNode;
  className: string;
  player: Player;
  reducedMotion: boolean;
  offsetX: number;
  offsetY: number;
  dragged: boolean;
  style: CSSProperties;
}) {
  if (reducedMotion) {
    return (
      <div className={className} data-player={player} style={{ ...style, opacity: dragged ? 0.25 : 1 }}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      className={className}
      data-player={player}
      initial={offsetX || offsetY ? { x: offsetX, y: offsetY } : { scale: 0.2, opacity: 0 }}
      animate={{ x: 0, y: 0, scale: 1, opacity: dragged ? 0.25 : 1 }}
      transition={{ type: 'spring', stiffness: 700, damping: 42, mass: 0.6 }}
      style={style}
    >
      {children}
    </motion.div>
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
