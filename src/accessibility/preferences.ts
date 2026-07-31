import '../styles/accessibility.css';

export const ACCESSIBILITY_STORAGE_KEY = 'gm-accessibility-v1';
export const ACCESSIBILITY_EVENT = 'gm:accessibility-change';

export type UiTheme = 'system' | 'dark' | 'light';
export type ContrastMode = 'standard' | 'high';
export type ColorVisionMode = 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'monochrome';
export type TextScale = 100 | 112 | 125;
export type TextSpacing = 'standard' | 'relaxed';
export type FontMode = 'default' | 'readable';
export type MotionMode = 'system' | 'reduced' | 'full';

export interface AccessibilityPreferences {
  version: 1;
  theme: UiTheme;
  contrast: ContrastMode;
  colorVision: ColorVisionMode;
  textScale: TextScale;
  textSpacing: TextSpacing;
  font: FontMode;
  motion: MotionMode;
  playerPatterns: boolean;
  verboseBoardLabels: boolean;
}

export const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  version: 1,
  // Preserve the platform's authored dark presentation by default. Players
  // can still choose System or Light explicitly in Accessibility settings.
  theme: 'dark',
  contrast: 'standard',
  colorVision: 'default',
  textScale: 100,
  textSpacing: 'standard',
  font: 'default',
  motion: 'system',
  playerPatterns: false,
  verboseBoardLabels: true,
};

const THEMES = new Set<UiTheme>(['system', 'dark', 'light']);
const CONTRASTS = new Set<ContrastMode>(['standard', 'high']);
const COLOR_VISION = new Set<ColorVisionMode>(['default', 'deuteranopia', 'protanopia', 'tritanopia', 'monochrome']);
const SCALES = new Set<TextScale>([100, 112, 125]);
const SPACING = new Set<TextSpacing>(['standard', 'relaxed']);
const FONTS = new Set<FontMode>(['default', 'readable']);
const MOTION = new Set<MotionMode>(['system', 'reduced', 'full']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAccessibilityPreferences(value: unknown): AccessibilityPreferences {
  if (!isRecord(value)) return { ...DEFAULT_ACCESSIBILITY_PREFERENCES };
  return {
    version: 1,
    theme: THEMES.has(value.theme as UiTheme) ? value.theme as UiTheme : DEFAULT_ACCESSIBILITY_PREFERENCES.theme,
    contrast: CONTRASTS.has(value.contrast as ContrastMode) ? value.contrast as ContrastMode : DEFAULT_ACCESSIBILITY_PREFERENCES.contrast,
    colorVision: COLOR_VISION.has(value.colorVision as ColorVisionMode) ? value.colorVision as ColorVisionMode : DEFAULT_ACCESSIBILITY_PREFERENCES.colorVision,
    textScale: SCALES.has(Number(value.textScale) as TextScale) ? Number(value.textScale) as TextScale : DEFAULT_ACCESSIBILITY_PREFERENCES.textScale,
    textSpacing: SPACING.has(value.textSpacing as TextSpacing) ? value.textSpacing as TextSpacing : DEFAULT_ACCESSIBILITY_PREFERENCES.textSpacing,
    font: FONTS.has(value.font as FontMode) ? value.font as FontMode : DEFAULT_ACCESSIBILITY_PREFERENCES.font,
    motion: MOTION.has(value.motion as MotionMode) ? value.motion as MotionMode : DEFAULT_ACCESSIBILITY_PREFERENCES.motion,
    playerPatterns: typeof value.playerPatterns === 'boolean' ? value.playerPatterns : DEFAULT_ACCESSIBILITY_PREFERENCES.playerPatterns,
    verboseBoardLabels: typeof value.verboseBoardLabels === 'boolean' ? value.verboseBoardLabels : DEFAULT_ACCESSIBILITY_PREFERENCES.verboseBoardLabels,
  };
}

export function readAccessibilityPreferences(
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): AccessibilityPreferences {
  if (!storage) return { ...DEFAULT_ACCESSIBILITY_PREFERENCES };
  try {
    return normalizeAccessibilityPreferences(JSON.parse(storage.getItem(ACCESSIBILITY_STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_ACCESSIBILITY_PREFERENCES };
  }
}

function mediaMatches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches;
}

export function applyAccessibilityPreferences(
  preferences: AccessibilityPreferences,
  root: HTMLElement | undefined = typeof document === 'undefined' ? undefined : document.documentElement,
): void {
  if (!root) return;
  const theme = preferences.theme === 'system'
    ? (mediaMatches('(prefers-color-scheme: light)') ? 'light' : 'dark')
    : preferences.theme;
  root.dataset.uiThemeChoice = preferences.theme;
  root.dataset.uiTheme = theme;
  root.dataset.contrast = preferences.contrast;
  root.dataset.colorVision = preferences.colorVision;
  root.dataset.textSpacing = preferences.textSpacing;
  root.dataset.readableFont = preferences.font === 'readable' ? 'true' : 'false';
  root.dataset.motion = preferences.motion;
  root.dataset.playerPatterns = preferences.playerPatterns ? 'true' : 'false';
  root.dataset.verboseBoardLabels = preferences.verboseBoardLabels ? 'true' : 'false';
  root.style.setProperty('--a11y-text-scale', String(preferences.textScale / 100));

  if (typeof document !== 'undefined') {
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    themeMeta?.setAttribute('content', theme === 'light' ? '#f5f7fc' : '#0a0a14');
  }
}

export function saveAccessibilityPreferences(
  preferences: AccessibilityPreferences,
  storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage,
): boolean {
  const normalized = normalizeAccessibilityPreferences(preferences);
  try {
    storage?.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    return false;
  }
  applyAccessibilityPreferences(normalized);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<AccessibilityPreferences>(ACCESSIBILITY_EVENT, { detail: normalized }));
  }
  return true;
}

export function updateAccessibilityPreferences(
  patch: Partial<AccessibilityPreferences>,
  storage?: Storage,
): AccessibilityPreferences {
  const current = readAccessibilityPreferences(storage);
  const next = normalizeAccessibilityPreferences({ ...current, ...patch, version: 1 });
  saveAccessibilityPreferences(next, storage);
  return next;
}

/**
 * Call once before React renders. The returned cleanup removes OS preference
 * listeners; explicit player choices still win over the operating system.
 */
export function hydrateAccessibilityPreferences(): () => void {
  const applyCurrent = () => applyAccessibilityPreferences(readAccessibilityPreferences());
  applyCurrent();
  if (typeof matchMedia !== 'function') return () => {};
  const scheme = matchMedia('(prefers-color-scheme: light)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const onSystemChange = () => {
    const current = readAccessibilityPreferences();
    if (current.theme === 'system' || current.motion === 'system') applyAccessibilityPreferences(current);
  };
  scheme.addEventListener?.('change', onSystemChange);
  motion.addEventListener?.('change', onSystemChange);
  return () => {
    scheme.removeEventListener?.('change', onSystemChange);
    motion.removeEventListener?.('change', onSystemChange);
  };
}
