import { create } from 'zustand';
import type { Difficulty, GameDefinition, GameStatus, LiveEval, MoveBase, MoveExplanation, Player } from '../engine/types';
import { getGame } from '../engine/registry';
import { engine } from '../engine/engineClient';
import { resolveClick } from '../engine/interaction';
import { playSound, resumeAudio, type SoundName } from '../audio/sound';
import { useProfile } from '../profile/profile';
import { useProgression } from '../progression/progression';
import { OnlineSession, type NetMsg, type NetStatus } from '../net/online';
import { DEFAULT_THEME_ID } from '../themes/boardThemes';
import { MAX_REPLAY_STATE_CHARS, summarize, saveRecord } from '../engine/reviewSummary';

export interface LogEntry {
  ply: number;
  player: Player;
  notation: string;
  explanation?: MoveExplanation;
  analyzing?: boolean;
  /** Serialized snapshots used by the post-game Replay Lab. Standard games only. */
  replayStateBefore?: string;
  replayStateAfter?: string;
}

/** The player's preferred difficulty, remembered across sessions (set in onboarding / the toolbar). */
function loadDifficulty(): Difficulty {
  try {
    const d = localStorage.getItem('gm-difficulty');
    if (d === 'tutor' || d === 'easy' || d === 'medium' || d === 'hard' || d === 'master') return d;
  } catch { /* ignore */ }
  return 'medium';
}

interface Snapshot { state: any; log: LogEntry[]; lastMove: LastMove | null; }
type LastMove = { from?: number; to: number; affected?: number[] };
export type Mode = 'ai' | 'pass' | 'online';
export type ViewMode = '2d' | '3d';

interface State {
  gameId: string | null;
  def: GameDefinition | null;
  state: any;
  past: Snapshot[];
  future: Snapshot[];
  log: LogEntry[];
  selected: number | null;
  targets: MoveBase[];
  selectedDrop: string | null;
  pendingTo: number | null; // Amazons: the amazon's chosen destination, awaiting an arrow shot
  lastMove: LastMove | null;
  status: GameStatus;
  thinking: boolean;
  hintMove: MoveBase | null;
  hintText: string | null;
  promotion: { from: number; to: number; options: MoveBase[] } | null;
  toast: string | null;

  // live engine evaluation (the advantage bar); null when the game has no liveEval
  liveEval: LiveEval | null;
  liveEvalLoading: boolean;
  // proactive coaching: what the opponent threatens on the human's turn
  liveThreats: string[];

  // online (P2P)
  net: OnlineSession | null;
  onlineStatus: NetStatus;
  onlineCode: string;
  onlineColor: Player;
  chat: { from: 'me' | 'them'; text: string }[];

  // settings (persist across new games)
  mode: Mode;
  humanColor: Player;
  difficulty: Difficulty;
  view: ViewMode;
  themeId: string;
  autoTutor: boolean;
  flipped: boolean;

  // actions
  newGame: (gameId: string) => void;
  loadPosition: (gameId: string, serialized: string, options?: { humanColor?: Player }) => boolean;
  restart: () => void;
  onCellClick: (cell: number) => void;
  selectHand: (kind: string) => void;
  passTurn: () => void;
  choosePromotion: (m: MoveBase | null) => void;
  undo: () => void;
  redo: () => void;
  requestHint: () => void;
  clearHint: () => void;
  setDifficulty: (d: Difficulty) => void;
  setMode: (m: Mode) => void;
  setHumanColor: (c: Player) => void;
  setView: (v: ViewMode) => void;
  setTheme: (id: string) => void;
  toggleAutoTutor: () => void;
  toggleFlip: () => void;
  setToast: (t: string | null) => void;
  driveAI: () => void;
  hostOnline: (code?: string) => void;
  joinOnline: (code: string) => void;
  leaveOnline: () => void;
  sendChat: (text: string) => void;
}

/** Keep one move per distinct destination cell (for highlighting click targets). */
function dedupeTo(moves: MoveBase[]): MoveBase[] {
  const seen = new Set<number>();
  const out: MoveBase[] = [];
  for (const m of moves) { if (!seen.has(m.to)) { seen.add(m.to); out.push(m); } }
  return out;
}

function ensureNotation(def: GameDefinition, state: any, move: MoveBase): MoveBase {
  if (move.notation) return move;
  const m = def.getLegalMoves(state, null).find((x) => x.id === move.id);
  return m ?? move;
}

function replayState(def: GameDefinition, state: unknown): string | undefined {
  try {
    const serialized = def.serialize(state);
    return typeof serialized === 'string'
      && serialized.length > 0
      && serialized.length <= MAX_REPLAY_STATE_CHARS
      ? serialized
      : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** Resolve an untrusted game id to the registry's canonical id. */
function canonicalGameId(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80) return null;
  const def = getGame(value.trim().toLowerCase());
  // Bespoke games use their own online runtime and must never enter this store.
  return def && !def.custom ? def.id : null;
}

/** Resolve an untrusted/worker move to the exact legal move object for `state`. */
function canonicalMove(def: GameDefinition, state: unknown, value: unknown): MoveBase | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 256) return null;
  const id = raw.id.trim();
  if (!id) return null;
  try {
    return def.getLegalMoves(state, null).find((move) => move.id === id) ?? null;
  } catch {
    return null;
  }
}

function canonicalChat(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Preserve ordinary whitespace/newlines while dropping invisible control
  // characters that should never enter the rendered chat transcript.
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 280);
  return text || null;
}

function canonicalRoomCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return code.length >= 3 && code.length <= 64 && /^[A-Z0-9-]+$/.test(code) ? code : null;
}

export const useGameStore = create<State>((set, get) => {
  let recorded = false; // ensure a finished game updates the profile only once
  let sessionVersion = 0;
  let positionVersion = 0;
  let aiSeq = 0;
  let tutorSeq = 0;
  let hintSeq = 0;
  let evalSeq = 0;
  let threatSeq = 0;
  let reviewTimer: ReturnType<typeof setTimeout> | null = null;
  let onlineReady: OnlineSession | null = null;

  const cancelReview = () => {
    if (reviewTimer !== null) clearTimeout(reviewTimer);
    reviewTimer = null;
  };

  /** Invalidate work tied to the current board position, without discarding
   * tutor results for earlier moves that are still present in this session. */
  const invalidatePositionWork = () => {
    positionVersion += 1;
    aiSeq += 1;
    hintSeq += 1;
    evalSeq += 1;
    threatSeq += 1;
    cancelReview();
  };

  /** Invalidate every asynchronous continuation for a game/history/mode. */
  const invalidateSessionWork = () => {
    sessionVersion += 1;
    tutorSeq += 1;
    invalidatePositionWork();
  };

  const closeNetwork = (net: OnlineSession | null, notifyPeer = true) => {
    if (!net) return;
    if (onlineReady === net) onlineReady = null;
    if (notifyPeer) {
      try { net.send({ t: 'bye' }); } catch { /* ignore */ }
    }
    // Detach first: OnlineSession.close() synchronously reports "closed", and
    // an old session must not overwrite the status of its replacement.
    net.onMsg = () => {};
    net.onStatus = () => {};
    try { net.close(); } catch { /* ignore */ }
  };

  /** Can the local human act right now? (vs-AI: my colour; online: my colour; pass: always) */
  const localCanMove = (): boolean => {
    const { def, state, status, mode, humanColor, onlineColor, onlineStatus } = get();
    if (!def || status.kind === 'win' || status.kind === 'draw') return false;
    const t = def.getTurn(state);
    if (mode === 'online') return onlineStatus === 'connected' && t === onlineColor;
    if (mode === 'ai') return t === humanColor;
    return true;
  };

  /** Sound + profile side-effects after a move lands. */
  const afterEffects = (move: MoveBase, status: GameStatus) => {
    let snd: SoundName = 'move';
    const m = move as any;
    if (move.to === -1) snd = 'click';
    else if (status.kind === 'win') snd = get().mode === 'ai' && status.winner !== get().humanColor ? 'lose' : 'win';
    else if (status.kind === 'draw') snd = 'draw';
    else if (status.kind === 'check') snd = 'check';
    else if (m.castle) snd = 'castle';
    else if (m.promo || m.promotion) snd = 'promote';
    else if (move.capture) snd = 'capture';
    playSound(snd);

    if ((status.kind === 'win' || status.kind === 'draw') && !recorded && get().mode === 'ai') {
      recorded = true;
      const hc = get().humanColor;
      const result = status.kind === 'draw' ? 'draw' : status.winner === hc ? 'win' : 'loss';
      const gameId = get().gameId;
      if (!gameId) return;
      try { useProfile.getState().recordResult(gameId, result, get().difficulty); } catch { /* ignore */ }
      // Persist a post-game review record once the final tutor notes have settled.
      const def = get().def;
      if (def && get().log.length >= 4) {
        const expectedSession = sessionVersion;
        const expectedPosition = positionVersion;
        const expectedState = get().state;
        const expectedStatus = get().status;
        const expectedMoves = get().log.length;
        cancelReview();
        reviewTimer = setTimeout(() => {
          reviewTimer = null;
          const current = get();
          // Restarting, navigating, undoing, or changing mode must never make a
          // completed game's delayed review read data from the next session.
          if (
            expectedSession !== sessionVersion ||
            expectedPosition !== positionVersion ||
            current.gameId !== gameId ||
            current.def !== def ||
            current.state !== expectedState ||
            current.status !== expectedStatus ||
            current.log.length !== expectedMoves ||
            current.mode !== 'ai'
          ) return;
          try {
            const rec = summarize(def, current.log, expectedStatus, hc);
            saveRecord(rec);
            const humanGraded = current.log.filter((e) => e.player === hc && e.explanation);
            // Never award an apparent 100% when no engine evidence exists.
            const gradedCount = rec.graded?.[hc] ?? humanGraded.length;
            if (gradedCount > 0) useProgression.getState().awardAccuracy(rec.acc[hc] ?? 0);
            // Flawless win: a victory with enough genuinely graded moves and
            // zero blunders.
            const blunders = humanGraded.filter((e) => e.explanation!.band === 'blunder').length;
            if (result === 'win' && humanGraded.length >= 6 && blunders === 0) {
              useProfile.getState().recordFlawlessWin();
            }
          } catch { /* ignore */ }
        }, 1100);
      }
    }
  };

  /** Apply a move, record it, snapshot for undo, and fetch its tutor note.
   *  `fromNet` = the move arrived from the remote peer (don't echo it back). */
  const commit = (move: MoveBase, before: any, fromNet = false) => {
    const current = get();
    const def = current.def;
    const gameId = current.gameId;
    // Object identity is intentional: all valid callers operate on the current
    // immutable position. It is a final guard against stale continuations.
    if (!def || !gameId || current.state !== before) return null;
    if (
      current.mode === 'online' &&
      !fromNet &&
      (current.onlineStatus !== 'connected' || !current.net || current.net !== onlineReady)
    ) return null;
    const replayStateBefore = replayState(def, before);
    const after = def.applyMove(before, move);
    const replayStateAfter = replayState(def, after);
    const player = def.getTurn(before);
    const status = def.getStatus(after);
    const idx = current.log.length;
    const willAnalyze = current.autoTutor && move.to !== -1;
    const entry: LogEntry = {
      ply: idx + 1,
      player,
      notation: move.notation ?? '…',
      analyzing: willAnalyze,
      ...(replayStateBefore ? { replayStateBefore } : {}),
      ...(replayStateAfter ? { replayStateAfter } : {}),
    };

    invalidatePositionWork();
    set((s) => ({
      past: [...s.past, { state: s.state, log: s.log, lastMove: s.lastMove }],
      future: [],
      state: after,
      log: [...s.log, entry],
      lastMove: { from: (move as any).from, to: move.to, affected: (move as any).affected },
      selected: null, targets: [], selectedDrop: null, pendingTo: null, status, promotion: null, hintMove: null, hintText: null,
    }));

    if (current.mode === 'online' && !fromNet && get().net === current.net) {
      current.net?.send({ t: 'move', move });
    }

    if (willAnalyze) {
      const expectedSession = sessionVersion;
      const expectedTutor = tutorSeq;
      const finishTutor = (exp?: MoveExplanation) => {
        const s = get();
        if (
          expectedSession !== sessionVersion ||
          expectedTutor !== tutorSeq ||
          s.gameId !== gameId ||
          s.def !== def ||
          s.log[idx] !== entry ||
          !s.autoTutor
        ) return;
        set({
          log: s.log.map((e, i) => (
            i === idx ? { ...e, ...(exp ? { explanation: exp } : {}), analyzing: false } : e
          )),
        });
      };
      engine.explain(gameId, before, move, after)
        .then((exp: MoveExplanation) => finishTutor(exp))
        .catch(() => finishTutor());
    }
    afterEffects(move, status);
    requestEval();
    requestThreats();
    return after;
  };

  /** Run a delayed driver only if no intervening session/position transition
   * made the timer obsolete. */
  function scheduleDrive(delay: number) {
    const expectedSession = sessionVersion;
    const expectedPosition = positionVersion;
    setTimeout(() => {
      if (expectedSession === sessionVersion && expectedPosition === positionVersion) drive();
    }, delay);
  }

  /** Drive forced passes and the AI's reply until it's the human's move again. */
  function drive() {
    const { def, gameId } = get();
    if (!def || !gameId) return;
    const st = get().state;
    const status = def.getStatus(st);
    if (status.kind === 'win' || status.kind === 'draw') return;

    // Forced pass (e.g. Reversi): exactly one legal move and it's a pass.
    const legal = def.getLegalMoves(st, null);
    if (legal.length === 1 && legal[0].to === -1) {
      if (get().mode === 'online') {
        // The remote side relays its own pass; the local side may pass only
        // after this exact room completed its handshake.
        if (
          def.getTurn(st) !== get().onlineColor ||
          get().onlineStatus !== 'connected' ||
          get().net !== onlineReady
        ) return;
      }
      const name = def.players[def.getTurn(st)].name;
      set({ toast: `${name} has no legal move and must pass.` });
      if (commit(legal[0], st)) scheduleDrive(450);
      return;
    }

    // AI's turn?
    if (get().mode === 'ai' && def.getTurn(st) !== get().humanColor && !get().thinking) {
      const expectedSession = sessionVersion;
      const expectedPosition = positionVersion;
      const expectedHuman = get().humanColor;
      const request = ++aiSeq;
      set({ thinking: true });
      engine.choose(gameId, st, get().difficulty)
        .then((move) => {
          const current = get();
          if (
            request !== aiSeq ||
            expectedSession !== sessionVersion ||
            expectedPosition !== positionVersion ||
            current.gameId !== gameId ||
            current.def !== def ||
            current.state !== st ||
            current.mode !== 'ai' ||
            current.humanColor !== expectedHuman
          ) return;
          if (!move) { set({ thinking: false }); return; }
          const legal = canonicalMove(def, st, move);
          if (!legal) { set({ thinking: false }); return; }
          set({ thinking: false });
          if (commit(ensureNotation(def, st, legal), st)) scheduleDrive(250);
        })
        .catch(() => {
          const current = get();
          if (
            request === aiSeq &&
            expectedSession === sessionVersion &&
            expectedPosition === positionVersion &&
            current.gameId === gameId &&
            current.def === def &&
            current.state === st
          ) set({ thinking: false });
        });
    }
  }

  /** Recompute the live advantage bar for the current position (off-thread, with
   *  a token so a stale result from a previous position is never shown). */
  const requestEval = () => {
    const { def, gameId, state } = get();
    if (!def || !gameId || def.evalScale == null) { set({ liveEval: null, liveEvalLoading: false }); return; }
    const status = def.getStatus(state);
    if (status.kind === 'win' || status.kind === 'draw') { set({ liveEvalLoading: false }); return; } // bar reads the result
    const expectedSession = sessionVersion;
    const expectedPosition = positionVersion;
    const seq = ++evalSeq;
    set({ liveEvalLoading: true });
    engine.analyze(gameId, state)
      .then((info) => {
        const current = get();
        if (
          seq === evalSeq &&
          expectedSession === sessionVersion &&
          expectedPosition === positionVersion &&
          current.gameId === gameId &&
          current.def === def &&
          current.state === state
        ) set({ liveEval: info, liveEvalLoading: false });
      })
      .catch(() => {
        const current = get();
        if (
          seq === evalSeq &&
          expectedSession === sessionVersion &&
          expectedPosition === positionVersion &&
          current.gameId === gameId &&
          current.state === state
        ) set({ liveEvalLoading: false });
      });
  };

  /** Warn the human, on their turn, about what the opponent is threatening. */
  const requestThreats = () => {
    const { def, gameId, state, autoTutor } = get();
    const seq = ++threatSeq;
    if (!def || !gameId || !def.threats || !autoTutor || !localCanMove()) { set({ liveThreats: [] }); return; }
    const expectedSession = sessionVersion;
    const expectedPosition = positionVersion;
    engine.threats(gameId, state)
      .then((threats) => {
        const current = get();
        if (
          seq === threatSeq &&
          expectedSession === sessionVersion &&
          expectedPosition === positionVersion &&
          current.gameId === gameId &&
          current.def === def &&
          current.state === state &&
          current.autoTutor &&
          localCanMove()
        ) set({ liveThreats: threats.filter((t): t is string => typeof t === 'string').slice(0, 12) });
      })
      .catch(() => {
        const current = get();
        if (
          seq === threatSeq &&
          expectedSession === sessionVersion &&
          expectedPosition === positionVersion &&
          current.gameId === gameId &&
          current.state === state
        ) set({ liveThreats: [] });
      });
  };

  /** Validate and apply an incoming message from the currently active peer.
   * Network objects are data, never trusted commands: moves are resolved back
   * to a canonical legal move before they reach a game implementation. */
  const handleMsg = (source: OnlineSession, raw: unknown) => {
    if (get().net !== source) return;
    const msg = asRecord(raw);
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'init') {
      if (source.role !== 'guest' || get().mode !== 'online' || onlineReady === source) return;
      const gameId = canonicalGameId(msg.gameId);
      if (!gameId) return;
      // The URL/game screen is the room contract. Silently switching the store
      // to a different game would leave the router and renderer inconsistent.
      if (get().gameId && get().gameId !== gameId) {
        set({ onlineStatus: 'error', toast: 'This room is hosting a different game.' });
        return;
      }
      onlineReady = source;
      set({ mode: 'online', onlineColor: 1, chat: [] });
      get().newGame(gameId);
      return;
    }

    if (msg.t === 'bye') {
      if (onlineReady === source) onlineReady = null;
      set({ onlineStatus: 'closed', toast: 'Opponent left the game.' });
      return;
    }

    // No gameplay/chat command is accepted until the room handshake completed.
    if (onlineReady !== source || get().mode !== 'online') return;

    if (msg.t === 'move') {
      const current = get();
      const { def, state } = current;
      if (!def || !state) return;
      // The peer may move only for the opposite colour and only with a move
      // legal in our authoritative local position.
      const remoteColor = (1 - current.onlineColor) as Player;
      if (def.getTurn(state) !== remoteColor) return;
      const move = canonicalMove(def, state, msg.move);
      if (!move) return;
      try {
        if (commit(move, state, true)) scheduleDrive(120);
      } catch {
        set({ toast: 'The incoming move was rejected; your position is unchanged.' });
      }
    } else if (msg.t === 'restart') {
      const gameId = canonicalGameId(msg.gameId);
      if (!gameId || gameId !== get().gameId) return;
      get().newGame(gameId);
    } else if (msg.t === 'chat') {
      const text = canonicalChat(msg.text);
      if (!text) return;
      set((s) => ({ chat: [...s.chat, { from: 'them' as const, text }].slice(-200) }));
    }
  };

  return {
    gameId: null, def: null, state: null,
    past: [], future: [], log: [],
    selected: null, targets: [], selectedDrop: null, pendingTo: null, lastMove: null,
    status: { kind: 'playing' }, thinking: false,
    hintMove: null, hintText: null, promotion: null, toast: null,
    liveEval: null, liveEvalLoading: false, liveThreats: [],
    net: null, onlineStatus: 'idle', onlineCode: '', onlineColor: 0, chat: [],
    mode: 'ai', humanColor: 0, difficulty: loadDifficulty(), view: '2d',
    themeId: DEFAULT_THEME_ID, autoTutor: true, flipped: false,

    newGame(gameId) {
      const def = getGame(gameId);
      if (!def) return;
      invalidateSessionWork();
      recorded = false;
      const state = def.createInitialState();
      set({
        gameId, def, state, past: [], future: [], log: [],
        selected: null, targets: [], selectedDrop: null, pendingTo: null, lastMove: null, status: def.getStatus(state),
        thinking: false, hintMove: null, hintText: null, promotion: null, toast: null,
        flipped: get().mode === 'online' ? get().onlineColor === 1 : get().mode === 'ai' && get().humanColor === 1,
        liveEval: null, liveEvalLoading: false, liveThreats: [],
      });
      requestEval();
      requestThreats();
      scheduleDrive(350);
    },

    loadPosition(gameId, serialized, options) {
      const def = getGame(gameId);
      if (!def || def.custom || typeof serialized !== 'string' || serialized.length === 0 || serialized.length > 180_000) return false;
      const requestedHuman = options?.humanColor;
      if (requestedHuman !== undefined && requestedHuman !== 0 && requestedHuman !== 1) return false;
      let state: unknown;
      try {
        state = def.deserialize(serialized);
        const view = def.getBoardView(state);
        if (
          !view
          || !Number.isInteger(view.rows)
          || !Number.isInteger(view.cols)
          || view.rows < 1
          || view.cols < 1
          || !Array.isArray(view.cells)
        ) return false;
        def.getTurn(state);
        def.getStatus(state);
      } catch {
        return false;
      }
      const previous = get();
      if (previous.mode === 'online') closeNetwork(previous.net);
      const humanColor = requestedHuman ?? previous.humanColor;
      invalidateSessionWork();
      recorded = false;
      set({
        gameId,
        def,
        state,
        mode: 'ai',
        humanColor,
        net: null,
        onlineStatus: 'idle',
        onlineCode: '',
        chat: [],
        past: [],
        future: [],
        log: [],
        selected: null,
        targets: [],
        selectedDrop: null,
        pendingTo: null,
        lastMove: null,
        status: def.getStatus(state),
        thinking: false,
        hintMove: null,
        hintText: null,
        promotion: null,
        toast: 'Verified physical-board position loaded.',
        flipped: humanColor === 1,
        liveEval: null,
        liveEvalLoading: false,
        liveThreats: [],
      });
      requestEval();
      requestThreats();
      scheduleDrive(350);
      return true;
    },

    hostOnline(code) {
      // Guard against a click event accidentally being passed as `code`.
      const requestedCode = typeof code === 'string' ? canonicalRoomCode(code) : null;
      if (typeof code === 'string' && !requestedCode) {
        set({ toast: 'That room code is not valid.' });
        return;
      }
      closeNetwork(get().net);
      invalidateSessionWork();
      const net = new OnlineSession();
      net.onMsg = (message: NetMsg) => handleMsg(net, message);
      net.onStatus = (st) => {
        if (get().net !== net) return;
        if (st === 'closed' || st === 'error') {
          if (onlineReady === net) onlineReady = null;
        }
        set({ onlineStatus: st });
        if (st === 'connected' && onlineReady !== net) {
          onlineReady = net;
          set({ onlineColor: 0, mode: 'online' });
          const gid = canonicalGameId(get().gameId);
          if (gid) { get().newGame(gid); net.send({ t: 'init', gameId: gid }); }
        }
      };
      set({
        mode: 'online', net, onlineColor: 0, onlineStatus: 'waiting',
        onlineCode: requestedCode ?? '', chat: [], thinking: false,
        hintMove: null, hintText: null, liveThreats: [], liveEvalLoading: false,
      });
      void net.host(requestedCode ?? undefined)
        .then((createdCode) => {
          if (get().net !== net) {
            closeNetwork(net, false);
            return;
          }
          set({ onlineCode: canonicalRoomCode(createdCode) ?? createdCode.slice(0, 64) });
        })
        .catch(() => {
          if (get().net === net) set({ onlineStatus: 'error' });
        });
    },

    joinOnline(code) {
      const roomCode = canonicalRoomCode(code);
      if (!roomCode) {
        set({ toast: 'Enter a valid room code.' });
        return;
      }
      closeNetwork(get().net);
      invalidateSessionWork();
      const net = new OnlineSession();
      net.onMsg = (message: NetMsg) => handleMsg(net, message);
      net.onStatus = (st) => {
        if (get().net !== net) return;
        if (st === 'closed' || st === 'error') {
          if (onlineReady === net) onlineReady = null;
        }
        set({ onlineStatus: st });
      };
      set({
        mode: 'online', net, onlineColor: 1, onlineStatus: 'waiting',
        onlineCode: roomCode, chat: [], thinking: false,
        hintMove: null, hintText: null, liveThreats: [], liveEvalLoading: false,
      });
      void net.join(roomCode)
        .then(() => {
          if (get().net !== net) closeNetwork(net, false);
        })
        .catch(() => {
          if (get().net === net) set({ onlineStatus: 'error' });
        });
    },

    leaveOnline() {
      const id = get().gameId;
      closeNetwork(get().net);
      invalidateSessionWork();
      set({
        net: null, mode: 'ai', onlineStatus: 'idle', onlineCode: '', chat: [],
        thinking: false, hintMove: null, hintText: null, liveThreats: [], liveEvalLoading: false,
      });
      if (id) get().newGame(id);
    },

    restart() {
      const id = get().gameId;
      if (!id) return;
      if (get().mode === 'online' && get().net && onlineReady === get().net) {
        get().net?.send({ t: 'restart', gameId: id });
      }
      get().newGame(id);
    },

    sendChat(text) {
      const message = canonicalChat(text);
      const net = get().net;
      if (!message || get().mode !== 'online' || !net || onlineReady !== net) return;
      net.send({ t: 'chat', text: message });
      set((s) => ({ chat: [...s.chat, { from: 'me' as const, text: message }].slice(-200) }));
    },

    onCellClick(cell) {
      resumeAudio();
      const { def, state, selected, thinking } = get();
      if (!def || thinking || !localCanMove()) return;

      if (def.interaction.type === 'drop') {
        const cols = def.getBoardView(state).cols;
        const m = def.getLegalMoves(state, null).find((mv) => mv.to % cols === cell % cols);
        if (m && commit(m, state)) scheduleDrive(120);
        return;
      }

      // Move-then-shoot (Amazons): select an amazon → click a destination → click
      // an arrow target. Self-contained; never reached by the other interactions.
      if (def.interaction.type === 'shoot') {
        const all = def.getLegalMoves(state, null);
        const sel = get().selected, pend = get().pendingTo;
        const ownAmazon = (c: number) => all.some((m) => m.from === c);
        if (pend !== null && sel !== null) {
          // Phase 2: pick the arrow target to complete the move.
          const m = all.find((mv) => mv.from === sel && mv.to === pend && (mv as any).arrow === cell);
          if (m) { if (commit(m, state)) scheduleDrive(120); return; }
          if (cell === sel || ownAmazon(cell)) { // restart selection on this amazon
            const dests = dedupeTo(all.filter((mv) => mv.from === cell));
            set({ selected: cell, pendingTo: null, targets: dests }); playSound('select'); return;
          }
          set({ selected: null, pendingTo: null, targets: [] }); return;
        }
        if (sel !== null && all.some((mv) => mv.from === sel && mv.to === cell)) {
          // Phase 1→2: destination chosen; show arrow targets from there.
          const arrows = all.filter((mv) => mv.from === sel && mv.to === cell)
            .map((mv) => ({ ...mv, to: (mv as any).arrow as number })); // synthetic targets at arrow squares
          set({ pendingTo: cell, targets: dedupeTo(arrows) }); playSound('select'); return;
        }
        if (ownAmazon(cell)) { // (re)select an amazon
          set({ selected: cell, pendingTo: null, targets: dedupeTo(all.filter((mv) => mv.from === cell)) }); playSound('select'); return;
        }
        set({ selected: null, pendingTo: null, targets: [] });
        return;
      }

      // Drop-from-hand (Shogi): a hand piece is armed; try to drop it here.
      const armed = get().selectedDrop;
      if (armed) {
        const m = get().targets.find((mv) => mv.drop === armed && mv.to === cell);
        set({ selectedDrop: null, targets: [], selected: null });
        if (m && commit(m, state)) scheduleDrive(120);
        return;
      }

      // Unified resolver (shared with interactive lessons).
      const r = resolveClick(def, state, selected, get().targets, cell);
      switch (r.kind) {
        case 'play': if (commit(r.move, state)) scheduleDrive(120); break;
        case 'select': set({ selected: r.cell, targets: r.targets }); playSound('select'); break;
        case 'promote': set({ promotion: { from: r.from, to: r.to, options: r.options } }); break;
        case 'clear': set({ selected: null, targets: [] }); break;
        case 'none': break;
      }
    },

    selectHand(kind) {
      const { def, state, thinking, selectedDrop } = get();
      if (!def || thinking || !localCanMove()) return;
      if (selectedDrop === kind) { set({ selectedDrop: null, targets: [] }); return; }
      const drops = def.getLegalMoves(state, null).filter((m) => m.drop === kind);
      set({ selectedDrop: kind, targets: drops, selected: null });
      playSound('select');
    },

    passTurn() {
      const { def, state, thinking } = get();
      if (!def || thinking || !localCanMove()) return;
      const pass = def.getLegalMoves(state, null).find((m) => m.to === -1);
      if (pass && commit(pass, state)) scheduleDrive(120);
    },

    choosePromotion(m) {
      if (!m) { set({ promotion: null }); return; }
      const before = get().state;
      if (commit(m, before)) scheduleDrive(120);
    },

    undo() {
      const current = get();
      if (!current.def || current.past.length === 0 || current.mode === 'online') return;
      invalidateSessionWork();
      set((s) => {
        if (!s.def || s.past.length === 0) return {} as any;
        const past = s.past.slice();
        const future = s.future.slice();
        future.unshift({ state: s.state, log: s.log, lastMove: s.lastMove });
        let snap = past.pop()!;
        if (s.mode === 'ai') {
          while (past.length > 0 && s.def.getTurn(snap.state) !== s.humanColor) {
            future.unshift({ state: snap.state, log: snap.log, lastMove: snap.lastMove });
            snap = past.pop()!;
          }
        }
        return {
          past, future, state: snap.state,
          log: snap.log.map((entry) => entry.analyzing ? { ...entry, analyzing: false } : entry),
          lastMove: snap.lastMove,
          status: s.def.getStatus(snap.state), selected: null, targets: [], selectedDrop: null, pendingTo: null,
          promotion: null, hintMove: null, hintText: null, thinking: false,
        };
      });
      requestEval();
      requestThreats();
      scheduleDrive(0);
    },

    redo() {
      const current = get();
      if (!current.def || current.future.length === 0 || current.mode === 'online') return;
      invalidateSessionWork();
      set((s) => {
        if (!s.def || s.future.length === 0) return {} as any;
        const future = s.future.slice();
        const past = s.past.slice();
        past.push({ state: s.state, log: s.log, lastMove: s.lastMove });
        const snap = future.shift()!;
        return {
          past, future, state: snap.state,
          log: snap.log.map((entry) => entry.analyzing ? { ...entry, analyzing: false } : entry),
          lastMove: snap.lastMove,
          status: s.def.getStatus(snap.state), selected: null, targets: [], selectedDrop: null, pendingTo: null,
          promotion: null, hintMove: null, hintText: null, thinking: false,
        };
      });
      requestEval();
      requestThreats();
      scheduleDrive(0);
    },

    requestHint() {
      const { def, gameId, state, status } = get();
      if (!def || !gameId || status.kind === 'win' || status.kind === 'draw') return;
      const expectedSession = sessionVersion;
      const expectedPosition = positionVersion;
      const request = ++hintSeq;
      engine.hint(gameId, state)
        .then((hint) => {
          const current = get();
          if (
            request !== hintSeq ||
            expectedSession !== sessionVersion ||
            expectedPosition !== positionVersion ||
            current.gameId !== gameId ||
            current.def !== def ||
            current.state !== state
          ) return;
          if (!hint) return;
          const move = canonicalMove(def, state, hint.move);
          if (move && typeof hint.text === 'string') {
            set({ hintMove: move, hintText: hint.text.slice(0, 1000) });
          }
        })
        .catch(() => { /* a failed hint must not disturb the current position */ });
    },
    clearHint() { hintSeq += 1; set({ hintMove: null, hintText: null }); },

    setDifficulty(d) {
      if (get().difficulty !== d) {
        aiSeq += 1;
        set({ difficulty: d, thinking: false });
        scheduleDrive(0);
      }
      try { localStorage.setItem('gm-difficulty', d); } catch { /* ignore */ }
    },
    setMode(m) {
      const current = get();
      if (current.mode === m) return;
      if (current.mode === 'online' && m !== 'online') closeNetwork(current.net);
      invalidateSessionWork();
      set({
        mode: m,
        ...(m !== 'online' ? { net: null, onlineStatus: 'idle' as NetStatus, onlineCode: '', chat: [] } : {}),
        thinking: false, hintMove: null, hintText: null, liveThreats: [], liveEvalLoading: false,
        log: current.log.map((entry) => entry.analyzing ? { ...entry, analyzing: false } : entry),
      });
      requestThreats();
      if (m === 'ai') scheduleDrive(0);
    },
    setHumanColor(c) {
      if (get().humanColor === c) return;
      const current = get();
      invalidateSessionWork();
      set({
        humanColor: c, thinking: false, hintMove: null, hintText: null,
        liveThreats: [], liveEvalLoading: false,
        log: current.log.map((entry) => entry.analyzing ? { ...entry, analyzing: false } : entry),
      });
      requestThreats();
      scheduleDrive(0);
    },
    setView(v) { set({ view: v }); },
    setTheme(id) { set({ themeId: id }); },
    toggleAutoTutor() {
      tutorSeq += 1;
      threatSeq += 1;
      const enabled = !get().autoTutor;
      set((s) => ({
        autoTutor: enabled,
        liveThreats: enabled ? s.liveThreats : [],
        log: enabled ? s.log : s.log.map((entry) => entry.analyzing ? { ...entry, analyzing: false } : entry),
      }));
      if (enabled) requestThreats();
    },
    toggleFlip() { set((s) => ({ flipped: !s.flipped })); },
    setToast(t) { set({ toast: t }); },
    driveAI() { drive(); },
  };
});
