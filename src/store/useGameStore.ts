import { create } from 'zustand';
import type { Difficulty, GameDefinition, GameStatus, MoveBase, MoveExplanation, Player } from '../engine/types';
import { getGame } from '../engine/registry';
import { engine } from '../engine/engineClient';
import { resolveClick } from '../engine/interaction';
import { playSound, resumeAudio, type SoundName } from '../audio/sound';
import { useProfile } from '../profile/profile';
import { OnlineSession, type NetMsg, type NetStatus } from '../net/online';
import { DEFAULT_THEME_ID } from '../themes/boardThemes';

export interface LogEntry {
  ply: number;
  player: Player;
  notation: string;
  explanation?: MoveExplanation;
  analyzing?: boolean;
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
  lastMove: LastMove | null;
  status: GameStatus;
  thinking: boolean;
  hintMove: MoveBase | null;
  hintText: string | null;
  promotion: { from: number; to: number; options: MoveBase[] } | null;
  toast: string | null;

  // online (P2P)
  net: OnlineSession | null;
  onlineStatus: NetStatus;
  onlineCode: string;
  onlineColor: Player;

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
  hostOnline: () => void;
  joinOnline: (code: string) => void;
  leaveOnline: () => void;
}

function ensureNotation(def: GameDefinition, state: any, move: MoveBase): MoveBase {
  if (move.notation) return move;
  const m = def.getLegalMoves(state, null).find((x) => x.id === move.id);
  return m ?? move;
}

export const useGameStore = create<State>((set, get) => {
  let recorded = false; // ensure a finished game updates the profile only once

  /** Can the local human act right now? (vs-AI: my colour; online: my colour; pass: always) */
  const localCanMove = (): boolean => {
    const { def, state, status, mode, humanColor, onlineColor } = get();
    if (!def || status.kind === 'win' || status.kind === 'draw') return false;
    const t = def.getTurn(state);
    if (mode === 'online') return t === onlineColor;
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
      try { useProfile.getState().recordResult(get().gameId!, result, get().difficulty); } catch { /* ignore */ }
    }
  };

  /** Apply a move, record it, snapshot for undo, and fetch its tutor note.
   *  `fromNet` = the move arrived from the remote peer (don't echo it back). */
  const commit = (move: MoveBase, before: any, fromNet = false) => {
    const def = get().def!;
    if (get().mode === 'online' && !fromNet) get().net?.send({ t: 'move', move });
    const after = def.applyMove(before, move);
    const player = def.getTurn(before);
    const status = def.getStatus(after);
    const idx = get().log.length;
    const willAnalyze = get().autoTutor && move.to !== -1;
    const entry: LogEntry = { ply: idx + 1, player, notation: move.notation ?? '…', analyzing: willAnalyze };

    set((s) => ({
      past: [...s.past, { state: s.state, log: s.log, lastMove: s.lastMove }],
      future: [],
      state: after,
      log: [...s.log, entry],
      lastMove: { from: (move as any).from, to: move.to, affected: (move as any).affected },
      selected: null, targets: [], selectedDrop: null, status, promotion: null, hintMove: null, hintText: null,
    }));

    if (willAnalyze) {
      engine.explain(get().gameId!, before, move, after)
        .then((exp: MoveExplanation) => set((s) => ({
          log: s.log.map((e, i) => (i === idx ? { ...e, explanation: exp, analyzing: false } : e)),
        })))
        .catch(() => set((s) => ({ log: s.log.map((e, i) => (i === idx ? { ...e, analyzing: false } : e)) })));
    }
    afterEffects(move, status);
    return after;
  };

  /** Drive forced passes and the AI's reply until it's the human's move again. */
  const drive = () => {
    const { def, gameId } = get();
    if (!def || !gameId) return;
    const st = get().state;
    const status = def.getStatus(st);
    if (status.kind === 'win' || status.kind === 'draw') return;

    // Forced pass (e.g. Reversi): exactly one legal move and it's a pass.
    const legal = def.getLegalMoves(st, null);
    if (legal.length === 1 && legal[0].to === -1) {
      if (get().mode === 'online' && def.getTurn(st) !== get().onlineColor) return; // remote will pass
      const name = def.players[def.getTurn(st)].name;
      set({ toast: `${name} has no legal move and must pass.` });
      commit(legal[0], st);
      setTimeout(drive, 450);
      return;
    }

    // AI's turn?
    if (get().mode === 'ai' && def.getTurn(st) !== get().humanColor && !get().thinking) {
      set({ thinking: true });
      engine.choose(gameId, st, get().difficulty)
        .then((move) => {
          if (!move) { set({ thinking: false }); return; }
          const cur = get().state; // unchanged, but read fresh
          commit(ensureNotation(def, cur, move), cur);
          set({ thinking: false });
          setTimeout(drive, 250);
        })
        .catch(() => set({ thinking: false }));
    }
  };

  /** Apply an incoming network message from the peer. */
  const handleMsg = (m: NetMsg) => {
    if (m.t === 'init') {
      set({ mode: 'online', onlineColor: 1 });
      get().newGame(m.gameId);
    } else if (m.t === 'move') {
      commit(m.move as MoveBase, get().state, true);
      setTimeout(drive, 120);
    } else if (m.t === 'restart') {
      get().newGame(m.gameId);
    } else if (m.t === 'bye') {
      set({ onlineStatus: 'closed', toast: 'Opponent left the game.' });
    }
  };

  return {
    gameId: null, def: null, state: null,
    past: [], future: [], log: [],
    selected: null, targets: [], selectedDrop: null, lastMove: null,
    status: { kind: 'playing' }, thinking: false,
    hintMove: null, hintText: null, promotion: null, toast: null,
    net: null, onlineStatus: 'idle', onlineCode: '', onlineColor: 0,
    mode: 'ai', humanColor: 0, difficulty: 'medium', view: '2d',
    themeId: DEFAULT_THEME_ID, autoTutor: true, flipped: false,

    newGame(gameId) {
      const def = getGame(gameId);
      if (!def) return;
      recorded = false;
      const state = def.createInitialState();
      set({
        gameId, def, state, past: [], future: [], log: [],
        selected: null, targets: [], selectedDrop: null, lastMove: null, status: def.getStatus(state),
        thinking: false, hintMove: null, hintText: null, promotion: null, toast: null,
        flipped: get().mode === 'online' ? get().onlineColor === 1 : get().mode === 'ai' && get().humanColor === 1,
      });
      setTimeout(drive, 350);
    },

    hostOnline() {
      const net = new OnlineSession();
      net.onMsg = handleMsg;
      net.onStatus = (st) => {
        set({ onlineStatus: st });
        if (st === 'connected') {
          set({ onlineColor: 0, mode: 'online' });
          const gid = get().gameId;
          if (gid) { get().newGame(gid); net.send({ t: 'init', gameId: gid }); }
        }
      };
      set({ mode: 'online', net, onlineColor: 0, onlineStatus: 'waiting', onlineCode: '' });
      net.host().then((code) => set({ onlineCode: code }));
    },

    joinOnline(code) {
      const net = new OnlineSession();
      net.onMsg = handleMsg;
      net.onStatus = (st) => set({ onlineStatus: st });
      set({ mode: 'online', net, onlineColor: 1, onlineStatus: 'waiting', onlineCode: code.trim().toUpperCase() });
      net.join(code);
    },

    leaveOnline() {
      get().net?.close();
      set({ net: null, mode: 'ai', onlineStatus: 'idle', onlineCode: '' });
      const id = get().gameId;
      if (id) get().newGame(id);
    },

    restart() {
      const id = get().gameId;
      if (id) get().newGame(id);
    },

    onCellClick(cell) {
      resumeAudio();
      const { def, state, selected, thinking } = get();
      if (!def || thinking || !localCanMove()) return;

      if (def.interaction.type === 'drop') {
        const cols = def.getBoardView(state).cols;
        const m = def.getLegalMoves(state, null).find((mv) => mv.to % cols === cell % cols);
        if (m) { commit(m, state); setTimeout(drive, 120); }
        return;
      }

      // Drop-from-hand (Shogi): a hand piece is armed; try to drop it here.
      const armed = get().selectedDrop;
      if (armed) {
        const m = get().targets.find((mv) => mv.drop === armed && mv.to === cell);
        set({ selectedDrop: null, targets: [], selected: null });
        if (m) { commit(m, state); setTimeout(drive, 120); }
        return;
      }

      // Unified resolver (shared with interactive lessons).
      const r = resolveClick(def, state, selected, get().targets, cell);
      switch (r.kind) {
        case 'play': commit(r.move, state); setTimeout(drive, 120); break;
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
      if (pass) { commit(pass, state); setTimeout(drive, 120); }
    },

    choosePromotion(m) {
      if (!m) { set({ promotion: null }); return; }
      const before = get().state;
      commit(m, before);
      setTimeout(drive, 120);
    },

    undo() {
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
          past, future, state: snap.state, log: snap.log, lastMove: snap.lastMove,
          status: s.def.getStatus(snap.state), selected: null, targets: [], selectedDrop: null,
          promotion: null, hintMove: null, hintText: null, thinking: false,
        };
      });
    },

    redo() {
      set((s) => {
        if (!s.def || s.future.length === 0) return {} as any;
        const future = s.future.slice();
        const past = s.past.slice();
        past.push({ state: s.state, log: s.log, lastMove: s.lastMove });
        const snap = future.shift()!;
        return {
          past, future, state: snap.state, log: snap.log, lastMove: snap.lastMove,
          status: s.def.getStatus(snap.state), selected: null, targets: [], selectedDrop: null,
          promotion: null, hintMove: null, hintText: null,
        };
      });
    },

    requestHint() {
      const { def, gameId, state, status } = get();
      if (!def || !gameId || status.kind === 'win' || status.kind === 'draw') return;
      engine.hint(gameId, state).then((h) => {
        if (h) set({ hintMove: h.move, hintText: h.text });
      });
    },
    clearHint() { set({ hintMove: null, hintText: null }); },

    setDifficulty(d) { set({ difficulty: d }); },
    setMode(m) { set({ mode: m }); },
    setHumanColor(c) { set({ humanColor: c }); },
    setView(v) { set({ view: v }); },
    setTheme(id) { set({ themeId: id }); },
    toggleAutoTutor() { set((s) => ({ autoTutor: !s.autoTutor })); },
    toggleFlip() { set((s) => ({ flipped: !s.flipped })); },
    setToast(t) { set({ toast: t }); },
    driveAI() { drive(); },
  };
});
