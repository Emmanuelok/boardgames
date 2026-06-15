/**
 * Hundreds of board templates. A curated set of premium collections —
 * including the signature "Liquid Glass" — plus a large procedurally generated
 * range so players always find a look they love. Each theme drives both the 2D
 * and 3D renderers.
 */
export type ThemeCategory =
  | 'Liquid Glass' | 'Classic' | 'Wood' | 'Marble' | 'Neon' | 'Nature' | 'Gemstone' | 'Minimal' | 'Gradient' | 'Mono';

export interface BoardTheme {
  id: string;
  name: string;
  category: ThemeCategory;
  light: string; // light square
  dark: string; // dark square
  surface: string; // board surface for non-checkered games
  grid: string; // grid / intersection lines
  border: string; // frame color
  pieceLight: string; // light-side piece fill
  pieceDark: string; // dark-side piece fill
  glass?: boolean; // glassmorphism squares (backdrop blur + translucency)
  glow?: string; // neon glow color
  bg?: [string, string]; // optional page backdrop gradient
  // 3D material hints
  metalness?: number;
  roughness?: number;
  transmission?: number; // 0..1 glass transmission
}

const hsl = (h: number, s: number, l: number, a = 1) =>
  a === 1 ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${a})`;

/* --------------------------- Liquid Glass --------------------------- */
const GLASS_COLORWAYS: Array<{ id: string; name: string; h: number; glow: string; bg: [string, string] }> = [
  { id: 'crystal', name: 'Liquid Glass · Crystal', h: 210, glow: '#7dd3fc', bg: ['#0b1220', '#1e293b'] },
  { id: 'sapphire', name: 'Liquid Glass · Sapphire', h: 224, glow: '#60a5fa', bg: ['#0a0f1f', '#1e2a52'] },
  { id: 'emerald', name: 'Liquid Glass · Emerald', h: 156, glow: '#34d399', bg: ['#04140f', '#0b3b2e'] },
  { id: 'amethyst', name: 'Liquid Glass · Amethyst', h: 276, glow: '#c084fc', bg: ['#140a1f', '#2e1b52'] },
  { id: 'rose', name: 'Liquid Glass · Rose Quartz', h: 338, glow: '#fb7185', bg: ['#1c0a14', '#3b0f24'] },
  { id: 'citrine', name: 'Liquid Glass · Citrine', h: 44, glow: '#fbbf24', bg: ['#1c1405', '#3b2e0b'] },
  { id: 'aqua', name: 'Liquid Glass · Aqua', h: 188, glow: '#22d3ee', bg: ['#04141a', '#0b333b'] },
  { id: 'smoke', name: 'Liquid Glass · Smoke', h: 220, glow: '#cbd5e1', bg: ['#0c0e12', '#23272e'] },
  { id: 'obsidian', name: 'Liquid Glass · Obsidian', h: 260, glow: '#a5b4fc', bg: ['#070709', '#161620'] },
  { id: 'coral', name: 'Liquid Glass · Coral', h: 14, glow: '#fb923c', bg: ['#1a0c07', '#3b1e0b'] },
];

function glassTheme(c: { id: string; name: string; h: number; glow: string; bg: [string, string] }): BoardTheme {
  return {
    id: `glass-${c.id}`,
    name: c.name,
    category: 'Liquid Glass',
    light: hsl(c.h, 60, 80, 0.22),
    dark: hsl(c.h, 70, 50, 0.28),
    surface: hsl(c.h, 50, 30, 0.16),
    grid: hsl(c.h, 60, 85, 0.35),
    border: hsl(c.h, 70, 80, 0.4),
    pieceLight: '#f8fafc',
    pieceDark: hsl(c.h, 35, 16),
    glass: true,
    glow: c.glow,
    bg: c.bg,
    metalness: 0.1,
    roughness: 0.05,
    transmission: 0.9,
  };
}

/* ----------------------------- Premium ----------------------------- */
const CURATED: BoardTheme[] = [
  // Classic tournament looks
  { id: 'tournament-green', name: 'Tournament Green', category: 'Classic', light: '#eeeed2', dark: '#769656', surface: '#769656', grid: '#5d7a44', border: '#3f5733', pieceLight: '#f7f7f2', pieceDark: '#2b2b2b', roughness: 0.6, metalness: 0 },
  { id: 'tournament-blue', name: 'Tournament Blue', category: 'Classic', light: '#dee3e6', dark: '#4b7399', surface: '#4b7399', grid: '#3a5c7d', border: '#2c4459', pieceLight: '#f7f7f2', pieceDark: '#22303c', roughness: 0.6 },
  { id: 'tournament-brown', name: 'Tournament Brown', category: 'Classic', light: '#f0d9b5', dark: '#b58863', surface: '#b58863', grid: '#9a6f4d', border: '#6f4e34', pieceLight: '#fffdf6', pieceDark: '#3a2a1c', roughness: 0.6 },
  { id: 'newspaper', name: 'Newspaper', category: 'Minimal', light: '#ffffff', dark: '#9aa0a6', surface: '#c8ccd0', grid: '#6b7075', border: '#3c3f43', pieceLight: '#fcfcfc', pieceDark: '#1b1d20', roughness: 0.8 },
  { id: 'midnight', name: 'Midnight', category: 'Minimal', light: '#3a4258', dark: '#1e2435', surface: '#1e2435', grid: '#48506a', border: '#10131d', pieceLight: '#e8ecf5', pieceDark: '#070912', bg: ['#0a0d16', '#161c2c'], roughness: 0.5 },
  // Wood
  { id: 'wood-walnut', name: 'Walnut', category: 'Wood', light: '#d9b08c', dark: '#774e2b', surface: '#774e2b', grid: '#5c3a1f', border: '#3e2814', pieceLight: '#f4e3cf', pieceDark: '#2c1a0d', roughness: 0.7 },
  { id: 'wood-mahogany', name: 'Mahogany', category: 'Wood', light: '#e3c39b', dark: '#8a3b2b', surface: '#8a3b2b', grid: '#6d2c1f', border: '#491c13', pieceLight: '#f6e6d2', pieceDark: '#341008', roughness: 0.65 },
  { id: 'wood-oak', name: 'Golden Oak', category: 'Wood', light: '#ecd9b0', dark: '#b9863f', surface: '#b9863f', grid: '#946a2f', border: '#6b4c20', pieceLight: '#fbf3df', pieceDark: '#3b2a12', roughness: 0.7 },
  { id: 'wood-ebony', name: 'Ebony & Ivory', category: 'Wood', light: '#e9e2d0', dark: '#3b3531', surface: '#3b3531', grid: '#2a2520', border: '#171411', pieceLight: '#fffaf0', pieceDark: '#0d0b09', roughness: 0.55 },
  // Marble
  { id: 'marble-white', name: 'Carrara Marble', category: 'Marble', light: '#f3f1ec', dark: '#b9bcc4', surface: '#cfd2d8', grid: '#9296a0', border: '#6c707a', pieceLight: '#ffffff', pieceDark: '#2a2d33', metalness: 0.2, roughness: 0.25 },
  { id: 'marble-black', name: 'Nero Marble', category: 'Marble', light: '#6f7378', dark: '#26292e', surface: '#26292e', grid: '#43474d', border: '#121417', pieceLight: '#eef1f4', pieceDark: '#050607', metalness: 0.3, roughness: 0.2, bg: ['#0a0b0d', '#1a1d22'] },
  { id: 'marble-green', name: 'Verde Marble', category: 'Marble', light: '#e7ead9', dark: '#3f6b4f', surface: '#3f6b4f', grid: '#2f5340', border: '#1f3a2b', pieceLight: '#fbfdf6', pieceDark: '#13241a', metalness: 0.2, roughness: 0.25 },
  // Neon
  { id: 'neon-cyber', name: 'Cyber Grid', category: 'Neon', light: '#101a2e', dark: '#0a1020', surface: '#0a1020', grid: '#22d3ee', border: '#0e7490', pieceLight: '#a5f3fc', pieceDark: '#f472b6', glow: '#22d3ee', bg: ['#04060f', '#0a1430'], metalness: 0.4, roughness: 0.2 },
  { id: 'neon-synthwave', name: 'Synthwave', category: 'Neon', light: '#2a1145', dark: '#1a0a30', surface: '#1a0a30', grid: '#f472b6', border: '#7c3aed', pieceLight: '#fde68a', pieceDark: '#22d3ee', glow: '#f472b6', bg: ['#190a2e', '#3b0f52'], metalness: 0.5, roughness: 0.15 },
  { id: 'neon-matrix', name: 'Matrix', category: 'Neon', light: '#06210f', dark: '#03140a', surface: '#03140a', grid: '#22c55e', border: '#15803d', pieceLight: '#86efac', pieceDark: '#064e25', glow: '#22c55e', bg: ['#020a05', '#04160b'], metalness: 0.3, roughness: 0.25 },
  { id: 'neon-inferno', name: 'Inferno', category: 'Neon', light: '#2a0e08', dark: '#190603', surface: '#190603', grid: '#fb923c', border: '#c2410c', pieceLight: '#fed7aa', pieceDark: '#f87171', glow: '#fb923c', bg: ['#120402', '#2a0a04'], metalness: 0.4, roughness: 0.2 },
  // Nature
  { id: 'nature-ocean', name: 'Ocean Depths', category: 'Nature', light: '#a9d6e5', dark: '#2a6f97', surface: '#2a6f97', grid: '#1d5476', border: '#143b54', pieceLight: '#f0f9ff', pieceDark: '#0b2a3d', bg: ['#04141f', '#0a3b52'], roughness: 0.4 },
  { id: 'nature-forest', name: 'Deep Forest', category: 'Nature', light: '#c3d8a8', dark: '#557153', surface: '#557153', grid: '#41583f', border: '#2c3c2b', pieceLight: '#f3f7ec', pieceDark: '#1c281b', bg: ['#0a140a', '#1f2e1d'], roughness: 0.6 },
  { id: 'nature-sunset', name: 'Sunset', category: 'Nature', light: '#ffd6a5', dark: '#e07a5f', surface: '#e07a5f', grid: '#c25c43', border: '#8a3c2a', pieceLight: '#fff5eb', pieceDark: '#3a160d', bg: ['#2a0f0a', '#5c2418'], roughness: 0.45 },
  { id: 'nature-sand', name: 'Desert Sand', category: 'Nature', light: '#f2e2c4', dark: '#c2a878', surface: '#c2a878', grid: '#9c8559', border: '#6f5e3c', pieceLight: '#fffaf0', pieceDark: '#3d3220', roughness: 0.7 },
];

/* --------------------- Procedural generation ----------------------- */
function generated(): BoardTheme[] {
  const out: BoardTheme[] = [];

  // Gemstone duotone — vivid jewel pairs across the hue wheel.
  for (let h = 0; h < 360; h += 8) {
    out.push({
      id: `gem-${h}`,
      name: `${HUE_NAME(h)} Jewel`,
      category: 'Gemstone',
      light: hsl(h, 70, 78),
      dark: hsl((h + 18) % 360, 65, 38),
      surface: hsl(h, 60, 42),
      grid: hsl(h, 50, 30),
      border: hsl(h, 55, 22),
      pieceLight: hsl(h, 30, 96),
      pieceDark: hsl((h + 180) % 360, 40, 14),
      metalness: 0.3, roughness: 0.3,
    });
  }
  // Minimal mono — clean, low-saturation boards across the wheel.
  for (let h = 0; h < 360; h += 6) {
    out.push({
      id: `mono-${h}`,
      name: `${HUE_NAME(h)} Minimal`,
      category: 'Mono',
      light: hsl(h, 18, 88),
      dark: hsl(h, 22, 52),
      surface: hsl(h, 20, 60),
      grid: hsl(h, 18, 42),
      border: hsl(h, 20, 34),
      pieceLight: hsl(h, 12, 97),
      pieceDark: hsl(h, 25, 16),
      roughness: 0.6,
    });
  }
  // Gradient pastels — soft, modern two-tone boards.
  for (let h = 0; h < 360; h += 8) {
    out.push({
      id: `pastel-${h}`,
      name: `${HUE_NAME(h)} Pastel`,
      category: 'Gradient',
      light: hsl(h, 55, 90),
      dark: hsl((h + 30) % 360, 50, 72),
      surface: hsl((h + 15) % 360, 50, 80),
      grid: hsl(h, 40, 60),
      border: hsl(h, 35, 55),
      pieceLight: '#ffffff',
      pieceDark: hsl(h, 35, 28),
      roughness: 0.5,
    });
  }
  // Deep dark duotone — moody, high-contrast boards.
  for (let h = 0; h < 360; h += 10) {
    out.push({
      id: `noir-${h}`,
      name: `${HUE_NAME(h)} Noir`,
      category: 'Minimal',
      light: hsl(h, 30, 40),
      dark: hsl(h, 35, 20),
      surface: hsl(h, 30, 24),
      grid: hsl(h, 40, 48),
      border: hsl(h, 30, 12),
      pieceLight: hsl(h, 25, 92),
      pieceDark: hsl(h, 45, 8),
      bg: [hsl(h, 30, 7), hsl(h, 35, 14)],
      metalness: 0.2, roughness: 0.4,
    });
  }
  return out;
}

function HUE_NAME(h: number): string {
  const names: Array<[number, string]> = [
    [12, 'Crimson'], [30, 'Amber'], [48, 'Gold'], [70, 'Lime'], [100, 'Fern'],
    [140, 'Emerald'], [165, 'Teal'], [190, 'Cyan'], [210, 'Azure'], [232, 'Sapphire'],
    [260, 'Indigo'], [285, 'Violet'], [312, 'Magenta'], [338, 'Rose'], [360, 'Crimson'],
  ];
  for (const [max, name] of names) if (h <= max) return name;
  return 'Crimson';
}

export const BOARD_THEMES: BoardTheme[] = [
  ...GLASS_COLORWAYS.map(glassTheme),
  ...CURATED,
  ...generated(),
];

export const THEME_MAP: Record<string, BoardTheme> = Object.fromEntries(BOARD_THEMES.map((t) => [t.id, t]));

export const THEME_CATEGORIES: ThemeCategory[] = [
  'Liquid Glass', 'Classic', 'Wood', 'Marble', 'Neon', 'Nature', 'Gemstone', 'Gradient', 'Minimal', 'Mono',
];

export const DEFAULT_THEME_ID = 'glass-crystal';

export function getTheme(id: string | undefined): BoardTheme {
  return (id && THEME_MAP[id]) || THEME_MAP[DEFAULT_THEME_ID];
}
