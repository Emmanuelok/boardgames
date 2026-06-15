/**
 * A clean, modern Staunton-inspired SVG chess set. Each piece is a crisp
 * silhouette filled with the side's colour and outlined for contrast, so it
 * reads sharply on any board theme — a big step up from Unicode glyphs.
 * viewBox is 45×45 (the lichess convention) so sets stay interchangeable.
 */
import { memo } from 'react';

export type PieceKind = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K';

interface Props {
  kind: string;
  fill: string;
  stroke: string;
  /** subtle top highlight colour for a little dimension */
  shine?: string;
}

function Shape({ kind, fill, stroke }: { kind: string; fill: string; stroke: string }) {
  const s = { fill, stroke, strokeWidth: 1.4, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  switch (kind) {
    case 'P':
      return (
        <>
          <circle cx="22.5" cy="15" r="6" {...s} />
          <path d="M16.5 19 h12 c0 5 -2 7 -3.5 9.5 h-5 C18.5 26 16.5 24 16.5 19 Z" {...s} />
          <path d="M12.5 38 c1.5 -5 5 -7 10 -7 s8.5 2 10 7 z" {...s} />
        </>
      );
    case 'R':
      return (
        <>
          <path d="M13 11 v4 h3 v-2 h3 v2 h3.5 v-2 h3 v2 h3.5 v-4 z" {...s} />
          <path d="M15 15 h15 l-1.5 14 h-12 z" {...s} />
          <path d="M11.5 38 c1 -5 4 -6.5 11 -6.5 s10 1.5 11 6.5 z" {...s} />
        </>
      );
    case 'B':
      return (
        <>
          <circle cx="22.5" cy="9.5" r="2.4" {...s} />
          <path d="M22.5 12 c6 4 8 10 8 14 c0 3 -3.5 5 -8 5 s-8 -2 -8 -5 c0 -4 2 -10 8 -14 Z" {...s} />
          <path d="M19.5 19 h6 M22.5 16 v6" stroke={stroke} strokeWidth="1.4" fill="none" strokeLinecap="round" />
          <path d="M12.5 38 c1.5 -5 5 -7 10 -7 s8.5 2 10 7 z" {...s} />
        </>
      );
    case 'N':
      return (
        <>
          <path
            d="M13 39 C13 31 16 26.5 21 23.5 C17.5 24.5 13.5 24 11.5 20.5 C10 18 11.5 15.3 14 14.8
               C14.6 12.8 16 11.2 18 10 C19.2 8 21 6.6 23.4 6.6 L22.4 9.5
               C27 8 31 10.6 32.6 16.6 C34 22.6 34 31 34 39 Z"
            {...s}
          />
          <path d="M23.4 6.6 L26.6 3.4 L28 7.6 Z" {...s} />
          <circle cx="17.6" cy="14.4" r="1.05" fill={stroke} stroke="none" />
          <path d="M24 11 C27.2 12.2 29 15.5 29 19.5" fill="none" stroke={stroke} strokeWidth="1.05" strokeLinecap="round" />
        </>
      );
    case 'Q':
      return (
        <>
          <path d="M11 16 l3 13 h17 l3 -13 l-5 8 l-2.5 -10 l-2.9 9 l-2.6 -9 l-2.6 9 l-2.9 -9 l-2.5 10 z" {...s} />
          <circle cx="11" cy="14.5" r="2.1" {...s} />
          <circle cx="22.5" cy="11.5" r="2.1" {...s} />
          <circle cx="34" cy="14.5" r="2.1" {...s} />
          <circle cx="16" cy="13" r="1.8" {...s} />
          <circle cx="29" cy="13" r="1.8" {...s} />
          <path d="M12.5 38 c1.5 -5.5 5 -7.5 10 -7.5 s8.5 2 10 7.5 z" {...s} />
        </>
      );
    case 'K':
      return (
        <>
          <path d="M21 6 h3 v3 h3 v3 h-3 v4 h-3 v-4 h-3 v-3 h3 z" {...s} />
          <path d="M14 21 c2 -4 6 -5 8.5 -5 s6.5 1 8.5 5 c-2 6 -4 8 -4 10 h-9 c0 -2 -2 -4 -4 -10 z" {...s} />
          <path d="M12.5 38 c1.5 -5.5 5 -7.5 10 -7.5 s8.5 2 10 7.5 z" {...s} />
        </>
      );
    default:
      return <circle cx="22.5" cy="22.5" r="9" {...s} />;
  }
}

export default memo(function ChessPiece({ kind, fill, stroke, shine }: Props) {
  return (
    <svg viewBox="0 0 45 45" width="100%" height="100%" style={{ display: 'block', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.4))' }}>
      <Shape kind={kind} fill={fill} stroke={stroke} />
      {shine && <Shape kind={kind} fill="none" stroke={shine} />}
    </svg>
  );
});
