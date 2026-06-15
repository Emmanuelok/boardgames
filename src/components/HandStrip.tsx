import type { GameDefinition, Player } from '../engine/types';
import { pieceStyleFor } from './pieceStyle';
import './HandStrip.css';

interface Props {
  def: GameDefinition;
  state: any;
  player: Player;
  armed: string | null;
  active: boolean;
  onPick: (kind: string) => void;
}

/** Captured pieces a player holds in hand and can drop (Shogi). Renders nothing
 *  for games without a hand. */
export default function HandStrip({ def, state, player, armed, active, onPick }: Props) {
  if (!def.getHand) return null;
  const hand = def.getHand(state).filter((h) => h.player === player && h.count > 0);
  return (
    <div className="hand">
      <span className="hand-label">{def.players[player].name}’s hand</span>
      {hand.length === 0 && <span className="hand-empty">—</span>}
      {hand.map((h) => (
        <button
          key={h.kind}
          className={`hand-piece pc xiangqi ${armed === h.kind && active ? 'armed' : ''}`}
          disabled={!active}
          onClick={() => onPick(h.kind)}
          style={pieceStyleFor('xiangqi', player, def.players[player].color)}
          title={`Drop ${h.kind}`}
        >
          <span className="glyph">{h.glyph}</span>
          {h.count > 1 && <span className="hand-count">{h.count}</span>}
        </button>
      ))}
    </div>
  );
}
