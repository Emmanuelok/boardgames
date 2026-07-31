import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import MiniBoard from '../components/MiniBoard';
import InteractiveLesson from '../components/InteractiveLesson';
import { GAME_MAP } from '../engine/registry';
import { getTheme, DEFAULT_THEME_ID } from '../themes/boardThemes';
import {
  CREATOR_GAMES,
  createDraft,
  exportCreation,
  importCreation,
  legalMoveOptions,
  useCreatorStore,
  validateCreation,
  type Creation,
  type CreationKind,
  type CourseStep,
} from '../creator/creations';
import './CreatorStudio.css';

const KINDS: Array<{ id: CreationKind; label: string; icon: string; detail: string }> = [
  { id: 'puzzle-pack', label: 'Puzzle Pack', icon: '◇', detail: 'Position, accepted move and layered hints' },
  { id: 'guided-course', label: 'Guided Course', icon: '▤', detail: 'A clear sequence of authored learning steps' },
  { id: 'challenge-variant', label: 'Challenge Variant', icon: '⬡', detail: 'A safe base-engine position, objective and limit' },
];

function readHandoff(): Creation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = JSON.parse(sessionStorage.getItem('gm-creator-handoff') || '{}') as { gameId?: unknown; setup?: unknown };
    if (typeof raw.gameId !== 'string' || typeof raw.setup !== 'string' || !GAME_MAP[raw.gameId] || GAME_MAP[raw.gameId].custom) return null;
    return { ...createDraft('puzzle-pack', raw.gameId), setup: raw.setup, title: `${GAME_MAP[raw.gameId].name} position` };
  } catch {
    return null;
  }
}

export default function CreatorStudio() {
  const store = useCreatorStore();
  const [draft, setDraft] = useState<Creation>(() => readHandoff() ?? createDraft());
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [shareCode, setShareCode] = useState('');
  const [importCode, setImportCode] = useState('');
  const theme = getTheme(DEFAULT_THEME_ID);
  const def = GAME_MAP[draft.gameId];
  const legalMoves = useMemo(() => legalMoveOptions(draft), [draft.gameId, draft.setup]);
  const challengeReady = draft.kind === 'puzzle-pack'
    && draft.prompt.trim().length > 0
    && draft.solutions.length > 0
    && !validateCreation({ ...draft, title: draft.title || 'Preview', description: draft.description || 'A complete preview description.' }, true).some((error) => error.includes('position') || error.includes('legal'));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.removeItem('gm-creator-handoff');
      } catch {
        // A blocked cleanup should not interrupt authoring the imported position.
      }
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, []);

  const patch = <K extends keyof Creation>(key: K, value: Creation[K]) => {
    setDraft((current) => ({ ...current, [key]: value, updatedAt: Date.now() }));
    setShareCode('');
    setErrors([]);
    setNotice('');
  };
  const updateHint = (index: 0 | 1, value: string) => {
    const hints = [...draft.hints];
    hints[index] = value;
    patch('hints', hints);
  };
  const chooseKind = (next: CreationKind) => {
    patch('kind', next);
  };
  const chooseGame = (gameId: string) => {
    const nextDef = GAME_MAP[gameId];
    if (!nextDef || nextDef.custom) return;
    setDraft((current) => ({
      ...current,
      gameId,
      setup: nextDef.serialize(nextDef.createInitialState()),
      solutions: [],
      updatedAt: Date.now(),
    }));
    setShareCode('');
    setErrors([]);
  };
  const save = () => {
    const creation = store.saveCreation({ ...draft, status: 'draft' });
    if (!creation) {
      setErrors(['The draft could not be saved. Review the selected game and position.']);
      return;
    }
    setDraft(creation);
    setShareCode('');
    setNotice('Draft saved on this device.');
  };
  const publish = () => {
    const result = store.publishCreation(draft);
    setErrors(result.errors);
    if (result.creation) {
      setDraft(result.creation);
      setShareCode('');
      setNotice('Published to your local creation library.');
    }
  };
  const share = async () => {
    try {
      const code = exportCreation(draft);
      setShareCode(code);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
        setNotice('Validated share code copied.');
      } else setNotice('Share code generated below.');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Could not export this creation.']);
    }
  };
  const importShared = () => {
    try {
      const creation = importCreation(importCode);
      setDraft(creation);
      setShareCode('');
      setImportCode('');
      setErrors([]);
      setNotice('Share code imported as a safe, editable draft.');
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Could not import that share code.']);
    }
  };
  const addStep = () => {
    if (draft.steps.length >= 12) return;
    patch('steps', [...draft.steps, { id: `step-${Date.now().toString(36)}`, title: `Step ${draft.steps.length + 1}`, body: 'Explain the next idea or decision.' }]);
  };
  const updateStep = (id: string, next: Partial<CourseStep>) => patch('steps', draft.steps.map((step) => step.id === id ? { ...step, ...next } : step));
  const removeStep = (id: string) => patch('steps', draft.steps.filter((step) => step.id !== id));

  return (
    <div className="creator-page">
      <header className="creator-hero">
        <div>
          <span className="section-overline">Feature 7 · safe no-code Creator Studio</span>
          <h1>Turn a strategic idea into something another learner can play.</h1>
          <p>Author engine-validated puzzles, structured courses and challenge positions without scripts or unsafe custom code. Every published move is checked against the selected game engine.</p>
        </div>
        <aside>
          <span>Creation safety</span>
          <strong>No arbitrary JavaScript</strong>
          <strong>No HTML or custom CSS</strong>
          <strong>Legal moves verified</strong>
          <strong>Share payloads bounded</strong>
        </aside>
      </header>

      <nav className="creator-kind-tabs" aria-label="Creation type">
        {KINDS.map((item) => (
          <button type="button" key={item.id} className={draft.kind === item.id ? 'on' : ''} aria-pressed={draft.kind === item.id} onClick={() => chooseKind(item.id)}>
            <span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong><small>{item.detail}</small>
          </button>
        ))}
      </nav>

      <div className="creator-workspace">
        <section className="creator-editor" aria-labelledby="creator-editor-title">
          <div className="creator-editor-head"><div><span className="section-overline">Authoring canvas</span><h2 id="creator-editor-title">{KINDS.find((item) => item.id === draft.kind)?.label}</h2></div><span className={`creator-status ${draft.status}`}>{draft.status}</span></div>
          <div className="creator-fields two">
            <label><span>Title</span><input value={draft.title} maxLength={90} placeholder="A memorable learning title" onChange={(event) => patch('title', event.target.value)} /></label>
            <label><span>Base game</span><select value={draft.gameId} onChange={(event) => chooseGame(event.target.value)}>{CREATOR_GAMES.map((game) => <option key={game.id} value={game.id}>{game.name} · {game.category}</option>)}</select></label>
          </div>
          <label><span>Description</span><textarea rows={3} maxLength={500} value={draft.description} placeholder="What will the learner understand or practise?" onChange={(event) => patch('description', event.target.value)} /></label>

          {draft.kind === 'puzzle-pack' && (
            <div className="creator-special">
              <label><span>Puzzle prompt</span><textarea rows={2} maxLength={500} value={draft.prompt} placeholder="Describe the decision without giving away the move." onChange={(event) => patch('prompt', event.target.value)} /></label>
              <label><span>Accepted legal move</span>
                <select value={draft.solutions[0] ?? ''} onChange={(event) => patch('solutions', event.target.value ? [event.target.value] : [])}>
                  <option value="">Choose a move from this position</option>
                  {legalMoves.map((move) => <option key={move} value={move}>{move}</option>)}
                </select>
              </label>
              <div className="creator-fields two">
                <label><span>Hint 1</span><input value={draft.hints[0] ?? ''} maxLength={240} onChange={(event) => updateHint(0, event.target.value)} /></label>
                <label><span>Hint 2</span><input value={draft.hints[1] ?? ''} maxLength={240} onChange={(event) => updateHint(1, event.target.value)} /></label>
              </div>
            </div>
          )}

          {draft.kind === 'guided-course' && (
            <div className="course-step-editor">
              <div className="creator-subhead"><div><span className="section-overline">Course sequence</span><h3>Build a clear progression.</h3></div><button className="btn sm" type="button" onClick={addStep}>+ Add step</button></div>
              {draft.steps.map((step, index) => (
                <article key={step.id}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <input aria-label={`Step ${index + 1} title`} value={step.title} maxLength={100} onChange={(event) => updateStep(step.id, { title: event.target.value })} />
                    <textarea aria-label={`Step ${index + 1} explanation`} rows={3} value={step.body} maxLength={900} onChange={(event) => updateStep(step.id, { body: event.target.value })} />
                  </div>
                  <button type="button" aria-label={`Remove step ${index + 1}`} onClick={() => removeStep(step.id)}>×</button>
                </article>
              ))}
            </div>
          )}

          {draft.kind === 'challenge-variant' && (
            <div className="creator-special">
              <label><span>Challenge objective</span><textarea rows={3} maxLength={500} value={draft.objective} placeholder="For example: build a connected route without losing the initiative." onChange={(event) => patch('objective', event.target.value)} /></label>
              <div className="creator-fields two">
                <label><span>Suggested resistance</span><select value={draft.difficulty} onChange={(event) => patch('difficulty', event.target.value as Creation['difficulty'])}><option value="tutor">Tutor</option><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="master">Master</option></select></label>
                <label><span>Time box</span><select value={draft.timeLimitMinutes} onChange={(event) => patch('timeLimitMinutes', Number(event.target.value))}>{[5,10,15,20,30,45,60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</select></label>
              </div>
            </div>
          )}

          <details className="creator-position">
            <summary>Advanced position data <span>engine-serialized · plain text</span></summary>
            <p>Use “Create from this position” during a standard game to fill this automatically, or paste a position produced by this platform.</p>
            <textarea rows={5} value={draft.setup} onChange={(event) => patch('setup', event.target.value)} />
            <button className="btn sm" type="button" onClick={() => patch('setup', def.serialize(def.createInitialState()))}>Reset to initial position</button>
          </details>

          {errors.length > 0 && <div className="creator-errors" role="alert"><strong>Review before publishing</strong>{errors.map((error) => <span key={error}>{error}</span>)}</div>}
          {notice && <p className="creator-notice" role="status">{notice}</p>}
          <div className="creator-actions">
            <button className="btn" type="button" onClick={save}>Save draft</button>
            <button className="btn" type="button" onClick={share}>Export validated code</button>
            <button className="btn primary glow" type="button" onClick={publish}>Publish to my library →</button>
          </div>
          {shareCode && <textarea className="creator-share-code" aria-label="Generated share code" readOnly value={shareCode} rows={4} onFocus={(event) => event.currentTarget.select()} />}
        </section>

        <aside className="creator-preview">
          <div className="creator-preview-head"><div><span className="section-overline">Live preview</span><h2>{draft.title || 'Untitled creation'}</h2></div><span>{def.name}</span></div>
          <p>{draft.description || 'Your description will guide the learner here.'}</p>
          <div className="creator-board">
            {challengeReady ? (
              <InteractiveLesson def={def} setup={draft.setup} theme={theme} challenge={{ prompt: draft.prompt, solution: draft.solutions, success: 'Solved — the authored move passed engine validation.' }} />
            ) : <MiniBoard def={def} setup={draft.setup} theme={theme} />}
          </div>
          {draft.kind === 'guided-course' && (
            <ol className="creator-course-preview">{draft.steps.map((step) => <li key={step.id}><span>{step.title}</span><p>{step.body}</p></li>)}</ol>
          )}
          {draft.kind === 'challenge-variant' && (
            <div className="creator-objective"><small>Challenge contract · {draft.timeLimitMinutes} min · {draft.difficulty}</small><strong>{draft.objective || 'Describe the objective in the editor.'}</strong><Link className="btn sm primary" to={`/play/${draft.gameId}?difficulty=${draft.difficulty}`}>Test base engine</Link></div>
          )}
        </aside>
      </div>

      <section className="creator-library">
        <div className="creator-library-head"><div><span className="section-overline">Local creation library</span><h2>Draft, test, publish and share.</h2></div><button className="btn" type="button" onClick={() => { setDraft(createDraft(draft.kind, draft.gameId)); setShareCode(''); setErrors([]); setNotice('New blank draft opened.'); }}>+ New creation</button></div>
        <div className="creator-import">
          <input value={importCode} placeholder="Paste a GM1 share code" onChange={(event) => setImportCode(event.target.value)} />
          <button className="btn" type="button" disabled={!importCode.trim()} onClick={importShared}>Import safely</button>
        </div>
        {store.creations.length === 0 ? (
          <div className="creator-empty glass-soft"><span>◇</span><h3>No saved creations yet.</h3><p>Save the draft above and it will remain available on this device.</p></div>
        ) : (
          <div className="creation-grid">
            {store.creations.map((creation) => (
              <article key={creation.id}>
                <span>{KINDS.find((item) => item.id === creation.kind)?.icon}</span>
                <small>{creation.status} · {GAME_MAP[creation.gameId]?.name}</small>
                <h3>{creation.title || 'Untitled draft'}</h3>
                <p>{creation.description || 'Description still needed.'}</p>
                <div><button type="button" onClick={() => { setDraft(creation); setShareCode(''); window.scrollTo({ top: 300, behavior: 'smooth' }); }}>Edit</button><button type="button" onClick={() => store.removeCreation(creation.id)}>Remove</button></div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
