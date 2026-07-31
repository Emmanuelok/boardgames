import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACCESSIBILITY_EVENT,
  DEFAULT_ACCESSIBILITY_PREFERENCES,
  applyAccessibilityPreferences,
  readAccessibilityPreferences,
  saveAccessibilityPreferences,
  type AccessibilityPreferences,
  type ColorVisionMode,
  type MotionMode,
  type TextScale,
  type UiTheme,
} from '../accessibility/preferences';
import {
  MUTE_STORAGE_KEY,
  SOUND_INTENSITY_STORAGE_KEY,
  getSoundIntensityMode,
  isMuted,
  playSound,
  resumeAudio,
  setMuted,
  setSoundIntensityMode,
  type SoundIntensityMode,
} from '../audio/sound';
import PwaStatus from '../pwa/PwaStatus';
import './Settings.css';

type Choice<T extends string | number> = { value: T; label: string; description: string };

const THEMES: Choice<UiTheme>[] = [
  { value: 'system', label: 'System', description: 'Follow this device automatically.' },
  { value: 'dark', label: 'Dark', description: 'Deep, low-glare surfaces.' },
  { value: 'light', label: 'Light', description: 'Bright paper-like surfaces.' },
];
const MOTION: Choice<MotionMode>[] = [
  { value: 'system', label: 'System', description: 'Respect the device setting.' },
  { value: 'reduced', label: 'Reduced', description: 'Remove decorative movement.' },
  { value: 'full', label: 'Full', description: 'Keep all interface motion.' },
];
const SOUND_MIXES: Choice<SoundIntensityMode>[] = [
  { value: 'cinematic', label: 'Cinematic', description: 'Highest impact with the fullest spatial ambience.' },
  { value: 'balanced', label: 'Balanced', description: 'Rich feedback with moderate impact and ambience.' },
  { value: 'quiet', label: 'Quiet', description: 'Essential cues at a lower level with restrained ambience.' },
];
const SCALES: Choice<TextScale>[] = [
  { value: 100, label: 'Standard', description: '100% interface text.' },
  { value: 112, label: 'Large', description: '112% interface text.' },
  { value: 125, label: 'Extra large', description: '125% interface text.' },
];
const COLOR_MODES: Choice<ColorVisionMode>[] = [
  { value: 'default', label: 'Original', description: 'GrandMaster’s default palette.' },
  { value: 'deuteranopia', label: 'Green-safe', description: 'Blue, amber and orange signals.' },
  { value: 'protanopia', label: 'Red-safe', description: 'Blue, cyan and violet signals.' },
  { value: 'tritanopia', label: 'Blue-safe', description: 'Red, teal and green signals.' },
  { value: 'monochrome', label: 'Monochrome', description: 'Meaning without hue.' },
];

export default function Settings() {
  const [preferences, setPreferences] = useState<AccessibilityPreferences>(() => readAccessibilityPreferences());
  const [soundEnabled, setSoundEnabled] = useState(() => !isMuted());
  const [soundMix, setSoundMix] = useState<SoundIntensityMode>(() => getSoundIntensityMode());
  const [saved, setSaved] = useState('');
  const savedTimer = useRef<number | null>(null);

  const showSaved = useCallback((message: string) => {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    setSaved(message);
    savedTimer.current = window.setTimeout(() => {
      setSaved('');
      savedTimer.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    const persisted = saveAccessibilityPreferences(preferences);
    if (!persisted) {
      // A privacy mode or full storage quota should not prevent the live
      // accessibility choice from taking effect for the current session.
      applyAccessibilityPreferences(preferences);
      window.dispatchEvent(new CustomEvent(ACCESSIBILITY_EVENT, { detail: preferences }));
    }
    showSaved(persisted
      ? 'Preferences applied and saved on this device.'
      : 'Preferences applied for this session, but this browser could not save them.');
  }, [preferences, showSaved]);

  useEffect(() => () => {
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
  }, []);

  const patch = <K extends keyof AccessibilityPreferences>(key: K, value: AccessibilityPreferences[K]) => {
    setPreferences((current) => ({ ...current, [key]: value }));
  };

  const updateSoundEnabled = (enabled: boolean) => {
    resumeAudio();
    setMuted(!enabled);
    setSoundEnabled(enabled);
    let persisted = false;
    try {
      persisted = localStorage.getItem(MUTE_STORAGE_KEY) === String(!enabled);
    } catch {
      // The in-memory preference still applies to the current session.
    }
    showSaved(persisted
      ? `Game sound switched ${enabled ? 'on' : 'off'} and saved on this device.`
      : `Game sound switched ${enabled ? 'on' : 'off'} for this session; this browser could not save it.`);
    if (enabled) playSound('select', { intensity: 0.55 });
  };

  const updateSoundMix = (mode: SoundIntensityMode) => {
    resumeAudio();
    setSoundIntensityMode(mode);
    setSoundMix(mode);
    let persisted = false;
    try {
      persisted = localStorage.getItem(SOUND_INTENSITY_STORAGE_KEY) === mode;
    } catch {
      // The in-memory preference still applies to the current session.
    }
    const label = SOUND_MIXES.find((choice) => choice.value === mode)?.label ?? 'Sound';
    showSaved(persisted
      ? `${label} mix saved on this device.`
      : `${label} mix applied for this session; this browser could not save it.`);
    if (soundEnabled) playSound('combo', { intensity: 0.8, depth: 3 });
  };

  const previewSound = () => {
    resumeAudio();
    let enabledWasPersisted = soundEnabled;
    if (!soundEnabled) {
      setMuted(false);
      setSoundEnabled(true);
      try {
        enabledWasPersisted = localStorage.getItem(MUTE_STORAGE_KEY) === 'false';
      } catch {
        enabledWasPersisted = false;
      }
    }
    playSound('complete', { intensity: 0.9, depth: 4 });
    showSaved(soundEnabled
      ? 'Playing the current game-completion mix.'
      : enabledWasPersisted
        ? 'Game sound switched on and saved; playing the completion mix.'
        : 'Game sound switched on for this session; playing the completion mix.');
  };

  return (
    <div className="settings-page">
      <header className="settings-hero">
        <span className="eyebrow">Designed around you</span>
        <h1>Accessibility & device settings</h1>
        <p>Every option applies immediately. When browser storage is available, it remains on this device and can be reset at any time.</p>
      </header>

      <div className="settings-layout">
        <section className="settings-stack" aria-label="Accessibility preferences">
          <PreferenceGroup
            title="Appearance"
            description="Choose the overall interface light level."
            choices={THEMES}
            value={preferences.theme}
            onChange={(value) => patch('theme', value)}
          />

          <PreferenceGroup
            title="Text size"
            description="Scale the entire interface without changing your browser zoom."
            choices={SCALES}
            value={preferences.textScale}
            onChange={(value) => patch('textScale', value)}
          />

          <PreferenceGroup
            title="Motion"
            description="Control animated backgrounds, transitions and celebration effects."
            choices={MOTION}
            value={preferences.motion}
            onChange={(value) => patch('motion', value)}
          />

          <fieldset className="settings-group settings-sound glass">
            <legend>Sound & game feedback</legend>
            <p>Choose how strongly moves, captures, cascades and victories respond. Every cue is an original real-time synthesis made for this platform.</p>
            <Toggle
              label="Game sound"
              description="Play contextual effects for interface actions and every supported game."
              checked={soundEnabled}
              onChange={updateSoundEnabled}
            />
            <div className="settings-sound-heading">
              <strong id="settings-sound-mix-label">Sound mix</strong>
              <span>Intensity changes the presentation, never the rules.</span>
            </div>
            <div className="settings-choices" role="radiogroup" aria-labelledby="settings-sound-mix-label">
              {SOUND_MIXES.map((choice) => (
                <label className={soundMix === choice.value ? 'on' : ''} key={choice.value}>
                  <input
                    type="radio"
                    name="preference-sound-mix"
                    value={choice.value}
                    checked={soundMix === choice.value}
                    onChange={() => updateSoundMix(choice.value)}
                  />
                  <strong>{choice.label}</strong>
                  <small>{choice.description}</small>
                </label>
              ))}
            </div>
            <button type="button" className="btn ghost settings-sound-preview" onClick={previewSound}>
              {soundEnabled ? 'Preview completion mix' : 'Turn on & preview completion mix'}
            </button>
          </fieldset>

          <PreferenceGroup
            title="Colour differentiation"
            description="Remap status colours for clearer separation."
            choices={COLOR_MODES}
            value={preferences.colorVision}
            onChange={(value) => patch('colorVision', value)}
          />

          <fieldset className="settings-group glass">
            <legend>Reading & board clarity</legend>
            <p>Layer extra cues on top of the selected appearance.</p>
            <Toggle
              label="High contrast"
              description="Sharper borders, stronger text and a larger focus indicator."
              checked={preferences.contrast === 'high'}
              onChange={(checked) => patch('contrast', checked ? 'high' : 'standard')}
            />
            <Toggle
              label="Readable font"
              description="Use wider, familiar system letterforms with neutral spacing."
              checked={preferences.font === 'readable'}
              onChange={(checked) => patch('font', checked ? 'readable' : 'default')}
            />
            <Toggle
              label="Relaxed text spacing"
              description="Increase line, letter and word spacing in reading-heavy views."
              checked={preferences.textSpacing === 'relaxed'}
              onChange={(checked) => patch('textSpacing', checked ? 'relaxed' : 'standard')}
            />
            <Toggle
              label="Piece patterns"
              description="Add stripes and dots so player pieces are not identified by colour alone."
              checked={preferences.playerPatterns}
              onChange={(checked) => patch('playerPatterns', checked)}
            />
            <Toggle
              label="Detailed board labels"
              description="Let screen readers announce coordinates, occupants and legal targets."
              checked={preferences.verboseBoardLabels}
              onChange={(checked) => patch('verboseBoardLabels', checked)}
            />
          </fieldset>
        </section>

        <aside className="settings-side">
          <section className="settings-preview glass" aria-label="Live preference preview">
            <span className="eyebrow">Live preview</span>
            <h2>Find the strongest move</h2>
            <p className="muted">Your position is described with colour, shape and clear language.</p>
            <div className="settings-preview-board" aria-hidden="true">
              <span className="p0">●</span><span /><span className="p1">●</span>
              <span /><span className="focus">◆</span><span />
              <span className="p1">●</span><span /><span className="p0">●</span>
            </div>
            <div className="row gap-xs wrap">
              <span className="chip active">Best move</span>
              <span className="chip">Keyboard ready</span>
            </div>
          </section>

          <PwaStatus />

          <button
            type="button"
            className="btn ghost settings-reset"
            onClick={() => setPreferences({ ...DEFAULT_ACCESSIBILITY_PREFERENCES })}
          >
            Reset accessibility preferences
          </button>
          <p className="settings-saved" role="status" aria-live="polite">{saved}</p>
        </aside>
      </div>
    </div>
  );
}

function PreferenceGroup<T extends string | number>({
  title,
  description,
  choices,
  value,
  onChange,
}: {
  title: string;
  description: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const groupName = `preference-${title.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <fieldset className="settings-group glass">
      <legend>{title}</legend>
      <p>{description}</p>
      <div className={`settings-choices ${choices.length > 3 ? 'many' : ''}`}>
        {choices.map((choice) => (
          <label className={value === choice.value ? 'on' : ''} key={String(choice.value)}>
            <input
              type="radio"
              name={groupName}
              value={String(choice.value)}
              checked={value === choice.value}
              onChange={() => onChange(choice.value)}
            />
            <strong>{choice.label}</strong>
            <small>{choice.description}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="settings-toggle">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
