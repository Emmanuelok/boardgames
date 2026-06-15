import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { BoardView, GameDefinition, GameStatus, MoveBase, Player } from '../engine/types';
import type { BoardTheme } from '../themes/boardThemes';

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

export default function Board3D(props: Props) {
  const { view } = props;
  const span = Math.max(view.rows, view.cols);
  const dist = span * 1.15 + 3;
  return (
    <div className="board3d glass-soft" style={{ aspectRatio: '1 / 1', width: '100%', maxWidth: 'min(78vh, 620px)', margin: '0 auto', borderRadius: 16, overflow: 'hidden' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, dist * 0.92, dist * 0.78], fov: 42 }}>
        <color attach="background" args={[props.theme.glass ? '#0a1018' : '#0c0f1a']} />
        <hemisphereLight intensity={0.55} groundColor={'#1a1f2e'} />
        <ambientLight intensity={0.35} />
        <directionalLight
          position={[span * 0.7, span * 1.4, span * 0.6]}
          intensity={1.5}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
          shadow-camera-far={50}
          shadow-camera-left={-span} shadow-camera-right={span}
          shadow-camera-top={span} shadow-camera-bottom={-span}
        />
        <pointLight position={[-span, span, -span]} intensity={0.4} color={props.theme.glow ?? '#88aaff'} />

        <Scene {...props} />

        <ContactShadows position={[0, -0.12, 0]} opacity={0.5} scale={span * 2.2} blur={2.4} far={6} resolution={512} color="#000000" />
        <OrbitControls
          enablePan={false}
          minDistance={span * 0.7}
          maxDistance={span * 2.2}
          maxPolarAngle={Math.PI / 2.05}
          autoRotate={false}
          target={[0, 0.2, 0]}
        />
      </Canvas>
    </div>
  );
}

function Scene(props: Props) {
  const { def, view, theme, flipped, selected, targets, lastMove, status, hint, onCell } = props;
  const { rows, cols } = view;
  const checkered = def.render.checkered;
  const style = def.render.pieceStyle;
  const intersections = !!def.render.intersections;

  const dRow = (r: number) => (flipped ? rows - 1 - r : r);
  const dCol = (c: number) => (flipped ? cols - 1 - c : c);
  const X = (c: number) => dCol(c) - (cols - 1) / 2;
  const Z = (r: number) => dRow(r) - (rows - 1) / 2;

  const targetSet = useMemo(() => {
    const m = new Map<number, MoveBase>();
    for (const t of targets) if (!m.has(t.to)) m.set(t.to, t);
    return m;
  }, [targets]);

  let checkSq = -1;
  if (status.kind === 'check') {
    const c = view.cells.find((cv) => cv.piece && cv.piece.kind === 'K' && cv.piece.player === status.player);
    if (c) checkSq = c.index;
  }

  const pieceColor = (player: Player) =>
    style === 'chess' || style === 'stone'
      ? (player === 0 ? theme.pieceLight : theme.pieceDark)
      : def.players[player].color;

  return (
    <group>
      {/* base plate */}
      <mesh receiveShadow position={[0, -0.18, 0]}>
        <boxGeometry args={[cols + 0.7, 0.3, rows + 0.7]} />
        <meshStandardMaterial color={theme.border} metalness={0.3} roughness={0.6} />
      </mesh>

      {view.cells.map((cell) => {
        const isDark = (cell.row + cell.col) % 2 === 1;
        const base = checkered ? (isDark ? theme.dark : theme.light) : theme.surface;
        const isSel = selected === cell.index;
        const isLast = !!lastMove && (lastMove.to === cell.index || lastMove.from === cell.index);
        const isCheck = checkSq === cell.index;
        const isHint = !!hint && (hint.to === cell.index || hint.from === cell.index);
        let color = base;
        let emissive = '#000000';
        let emI = 0;
        if (isLast) { emissive = '#ffd166'; emI = 0.18; }
        if (isSel) { emissive = '#ffffff'; emI = 0.3; }
        if (isHint) { emissive = '#34d399'; emI = 0.4; }
        if (isCheck) { emissive = '#f87171'; emI = 0.6; }
        const target = targetSet.get(cell.index);

        return (
          <group key={cell.index} position={[X(cell.col), 0, Z(cell.row)]}>
            {cell.playable !== false && (
              <mesh
                receiveShadow
                position={[0, 0, 0]}
                onClick={(e) => { e.stopPropagation(); onCell(cell.index); }}
                onPointerOver={() => (document.body.style.cursor = 'pointer')}
                onPointerOut={() => (document.body.style.cursor = 'auto')}
              >
                <boxGeometry args={[0.98, 0.16, 0.98]} />
                {theme.glass
                  ? <meshPhysicalMaterial color={color} transparent opacity={0.55} roughness={0.05} metalness={0} transmission={0.6} thickness={0.5} emissive={emissive} emissiveIntensity={emI} />
                  : <meshStandardMaterial color={color} roughness={theme.roughness ?? 0.5} metalness={theme.metalness ?? 0.1} emissive={emissive} emissiveIntensity={emI} />}
              </mesh>
            )}

            {target && !cell.piece && (
              <mesh position={[0, 0.16, 0]}>
                <cylinderGeometry args={[0.16, 0.16, 0.05, 24]} />
                <meshStandardMaterial color={'#9fb4ff'} emissive={'#6d8bff'} emissiveIntensity={0.5} transparent opacity={0.85} />
              </mesh>
            )}
            {target && cell.piece && (
              <mesh position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.46, 0.05, 12, 28]} />
                <meshStandardMaterial color={'#f87171'} emissive={'#f87171'} emissiveIntensity={0.45} />
              </mesh>
            )}

            {cell.piece && (
              <Piece
                style={style}
                kind={cell.piece.kind}
                crowned={!!cell.piece.crowned}
                color={pieceColor(cell.piece.player)}
                metalness={theme.metalness ?? 0.2}
                roughness={theme.roughness ?? 0.4}
                intersections={intersections}
              />
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ----------------------------- Pieces ------------------------------ */

const profileCache: Record<string, THREE.Vector2[]> = {};
function profile(name: string, pts: number[][]): THREE.Vector2[] {
  if (!profileCache[name]) profileCache[name] = pts.map(([x, y]) => new THREE.Vector2(x, y));
  return profileCache[name];
}

const PROFILES: Record<string, number[][]> = {
  P: [[0, 0], [0.3, 0], [0.3, 0.05], [0.17, 0.1], [0.14, 0.34], [0.23, 0.4], [0.2, 0.46], [0.13, 0.5], [0.16, 0.56], [0, 0.62]],
  B: [[0, 0], [0.32, 0], [0.32, 0.05], [0.16, 0.1], [0.13, 0.5], [0.22, 0.58], [0.16, 0.64], [0.1, 0.78], [0.13, 0.84], [0, 0.92]],
  R: [[0, 0], [0.34, 0], [0.34, 0.06], [0.2, 0.12], [0.18, 0.52], [0.24, 0.56], [0.26, 0.7], [0.26, 0.74], [0, 0.74]],
  Q: [[0, 0], [0.36, 0], [0.36, 0.06], [0.18, 0.12], [0.15, 0.58], [0.26, 0.66], [0.22, 0.74], [0.26, 0.86], [0, 0.92]],
  K: [[0, 0], [0.36, 0], [0.36, 0.06], [0.18, 0.12], [0.15, 0.6], [0.26, 0.68], [0.22, 0.78], [0.24, 0.9], [0, 0.94]],
};

function Piece({ style, kind, crowned, color, metalness, roughness }: {
  style: string; kind: string; crowned: boolean; color: string; metalness: number; roughness: number; intersections: boolean;
}) {
  const mat = <meshStandardMaterial color={color} metalness={Math.min(0.6, metalness + 0.1)} roughness={Math.max(0.15, roughness)} />;

  if (style === 'chess') {
    const prof = PROFILES[kind] ?? PROFILES.P;
    if (kind === 'N') return <Knight color={color} metalness={metalness} roughness={roughness} />;
    return (
      <group position={[0, 0.08, 0]}>
        <mesh castShadow scale={0.9}>
          <latheGeometry args={[profile(kind, prof), 40]} />
          {mat}
        </mesh>
        {kind === 'K' && (
          <group position={[0, 0.92 * 0.9 + 0.02, 0]}>
            <mesh castShadow><boxGeometry args={[0.06, 0.22, 0.06]} />{mat}</mesh>
            <mesh castShadow position={[0, 0.04, 0]}><boxGeometry args={[0.16, 0.06, 0.06]} />{mat}</mesh>
          </group>
        )}
        {kind === 'Q' && [0, 1, 2, 3, 4].map((i) => (
          <mesh castShadow key={i} position={[Math.cos((i / 5) * Math.PI * 2) * 0.17, 0.86 * 0.9, Math.sin((i / 5) * Math.PI * 2) * 0.17]}>
            <sphereGeometry args={[0.05, 12, 12]} />{mat}
          </mesh>
        ))}
        {kind === 'R' && [0, 1, 2, 3].map((i) => (
          <mesh castShadow key={i} position={[Math.cos((i / 4) * Math.PI * 2) * 0.2, 0.72 * 0.9, Math.sin((i / 4) * Math.PI * 2) * 0.2]}>
            <boxGeometry args={[0.1, 0.12, 0.1]} />{mat}
          </mesh>
        ))}
      </group>
    );
  }

  if (style === 'disc' || style === 'token' || style === 'xiangqi') {
    return <mesh castShadow position={[0, 0.18, 0]}><cylinderGeometry args={[0.42, 0.42, 0.2, 36]} />{mat}</mesh>;
  }
  if (style === 'checker') {
    return (
      <group position={[0, 0.16, 0]}>
        <mesh castShadow><cylinderGeometry args={[0.4, 0.4, 0.16, 36]} />{mat}</mesh>
        <mesh castShadow position={[0, 0.09, 0]}><torusGeometry args={[0.28, 0.04, 10, 28]} />{mat}</mesh>
        {crowned && <mesh castShadow position={[0, 0.2, 0]}><coneGeometry args={[0.2, 0.22, 16]} /><meshStandardMaterial color={'#ffd700'} metalness={0.6} roughness={0.25} /></mesh>}
      </group>
    );
  }
  if (style === 'stone') {
    return <mesh castShadow position={[0, 0.16, 0]} scale={[1, 0.55, 1]}><sphereGeometry args={[0.4, 28, 28]} />{mat}</mesh>;
  }
  if (style === 'mark') {
    if (kind === 'O') {
      return <mesh castShadow position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.27, 0.09, 16, 32]} />{mat}</mesh>;
    }
    return (
      <group position={[0, 0.25, 0]} rotation={[0, Math.PI / 4, 0]}>
        <mesh castShadow><boxGeometry args={[0.66, 0.16, 0.16]} />{mat}</mesh>
        <mesh castShadow rotation={[0, Math.PI / 2, 0]}><boxGeometry args={[0.66, 0.16, 0.16]} />{mat}</mesh>
      </group>
    );
  }
  return <mesh castShadow position={[0, 0.2, 0]}><sphereGeometry args={[0.3, 20, 20]} />{mat}</mesh>;
}

function Knight({ color, metalness, roughness }: { color: string; metalness: number; roughness: number }) {
  const mat = <meshStandardMaterial color={color} metalness={Math.min(0.6, metalness + 0.1)} roughness={Math.max(0.15, roughness)} />;
  return (
    <group position={[0, 0.08, 0]}>
      <mesh castShadow><cylinderGeometry args={[0.3, 0.34, 0.16, 32]} />{mat}</mesh>
      <mesh castShadow position={[0, 0.14, 0]}><cylinderGeometry args={[0.17, 0.26, 0.2, 24]} />{mat}</mesh>
      {/* head */}
      <mesh castShadow position={[-0.02, 0.42, 0.04]} rotation={[0.5, 0, 0]}><boxGeometry args={[0.18, 0.42, 0.2]} />{mat}</mesh>
      <mesh castShadow position={[-0.02, 0.58, 0.2]} rotation={[1.0, 0, 0]}><boxGeometry args={[0.16, 0.26, 0.18]} />{mat}</mesh>
      {/* ears */}
      <mesh castShadow position={[-0.06, 0.66, 0.04]}><boxGeometry args={[0.05, 0.12, 0.05]} />{mat}</mesh>
      <mesh castShadow position={[0.02, 0.66, 0.04]}><boxGeometry args={[0.05, 0.12, 0.05]} />{mat}</mesh>
    </group>
  );
}
