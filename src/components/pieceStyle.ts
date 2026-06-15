import type { CSSProperties } from 'react';
import type { Player } from '../engine/types';

/** Inline style for a 2D piece of a given visual style and colour. */
export function pieceStyleFor(style: string, player: Player, color: string): CSSProperties {
  if (style === 'chess') return { color, filter: `drop-shadow(0 3px 4px rgba(0,0,0,${player === 0 ? 0.45 : 0.6}))` };
  if (style === 'mark') return { color };
  if (style === 'disc') return {
    background: `radial-gradient(circle at 35% 30%, ${lighten(color)}, ${color} 62%, ${darken(color)} 100%)`,
    boxShadow: 'inset 0 -3px 8px rgba(0,0,0,0.35), 0 3px 8px rgba(0,0,0,0.4)',
  };
  if (style === 'checker') return {
    background: `radial-gradient(circle at 35% 30%, ${lighten(color)}, ${color} 70%)`,
    boxShadow: `inset 0 0 0 4px ${darken(color)}, inset 0 -3px 8px rgba(0,0,0,0.4), 0 3px 8px rgba(0,0,0,0.45)`,
  };
  if (style === 'stone') return {
    background: `radial-gradient(circle at 33% 28%, ${lighten(color)}, ${color} 68%, ${darken(color)} 100%)`,
    boxShadow: '0 3px 8px rgba(0,0,0,0.5)',
  };
  if (style === 'xiangqi') return {
    // a round wooden tile; the character/ring takes the player's colour
    background: 'radial-gradient(circle at 38% 30%, #fdf3dd, #ecd6ab 70%, #dcc08c)',
    color,
    boxShadow: `inset 0 0 0 2px ${color}, inset 0 -2px 6px rgba(0,0,0,0.28), 0 3px 7px rgba(0,0,0,0.45)`,
    borderRadius: '50%',
  };
  return { background: color };
}

function clampHex(n: number) { return Math.max(0, Math.min(255, Math.round(n))); }
function parse(color: string): [number, number, number] | null {
  if (color.startsWith('#')) {
    const h = color.slice(1);
    const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  return null;
}
export function lighten(color: string, amt = 42): string {
  const p = parse(color); if (!p) return color;
  return `rgb(${clampHex(p[0] + amt)},${clampHex(p[1] + amt)},${clampHex(p[2] + amt)})`;
}
export function darken(color: string, amt = 48): string {
  const p = parse(color); if (!p) return color;
  return `rgb(${clampHex(p[0] - amt)},${clampHex(p[1] - amt)},${clampHex(p[2] - amt)})`;
}
