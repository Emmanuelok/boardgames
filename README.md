# ♛ GrandMaster — AI Board Game Center

**The most intelligent board game center, built for players who want to *understand* the game — not just play it.**

Play Chess and a growing universe of board games against an AI that grades and
explains **every single move**, in stunning **2D and 3D**, dressed in any of
**200+ board themes** — including the signature **Liquid Glass**.

![stack](https://img.shields.io/badge/React-18-61dafb) ![stack](https://img.shields.io/badge/TypeScript-5-3178c6) ![stack](https://img.shields.io/badge/Three.js-3D-000000) ![stack](https://img.shields.io/badge/Vite-5-646cff)

---

## ✨ What makes it special

### 🧠 A world-class step-by-step tutor
Every move you (or the AI) make is analysed and graded **Brilliant → Blunder**,
then explained in plain English:

- **Captures** judged with **Static Exchange Evaluation** — does it win or lose material?
- **Tactics detected**: forks, double attacks, pins, hanging pieces, checks & mates.
- **Plans & principles**: development, centre control, castling, king safety, promotion.
- A **better idea** is shown whenever you fall short, with an evaluation bar that
  swings as the game does.

The chess engine behind it is a real one — fully legal move generation
(verified by **perft** against known node counts including the *Kiwipete*
position), iterative-deepening **alpha-beta search** with quiescence, an
**opening book**, and tuned evaluation (material, piece-square tables, pawn
structure, king safety).

### 🎮 Stunning 2D **and** 3D boards
A crisp, animated 2D view with sliding pieces, legal-move dots, last-move and
check highlights — or swing around a fully interactive **3D board** with real
lighting, shadows and procedurally-modelled pieces (orbit, zoom, the works).

### 💎 200+ board themes, including Liquid Glass
Curated **Liquid Glass**, Wood, Marble, Neon, Nature and Gemstone collections,
plus a huge procedurally generated range. Live-preview and switch instantly.

### ⚙️ An opponent for everyone
Dial the AI from a gentle **Beginner** to a relentless **Master**, play
**pass-and-play** with a friend, or use **Tutor** mode to learn as you go.

---

## 🎲 The games

| Game | Board | Highlights |
|------|-------|-----------|
| **Chess** | 8×8 | Full rules, opening book, SEE-based tactical tutor |
| **Xiangqi (Chinese Chess)** | 9×10 | Cannons, the river & palace, flying-general rule |
| **Checkers** | 8×8 | Mandatory captures, multi-jumps, kings |
| **International Draughts** | 10×10 | Flying kings, capture-the-maximum rule |
| **Reversi (Othello)** | 8×8 | Corner strategy, mobility, forced passes |
| **Connect Four** | 7×6 | Drop mechanics, double-threat tutoring |
| **Go** | 9×9 | Liberties, captures, ko, area scoring, passing |
| **Gomoku** | 15×15 | Five-in-a-row, open-three / four detection |
| **Pente** | 13×13 | Five-in-a-row + custodial pair captures |
| **Tic-Tac-Toe** | 3×3 | Perfect-play AI, fork lessons |

Every game ships with a **classical, in-depth tutorial** (rules → strategy)
with illustrated positions, and the same move-by-move tutor.

---

## 🏗️ Architecture

The whole center is built on **one universal abstraction**, so adding any board
game in the world is just a matter of implementing a single interface.

```
src/
  engine/
    types.ts        # GameDefinition — the universal interface every game implements
    ai.ts           # generic alpha-beta search shared by the lighter games
    grade.ts        # move-quality grading (centipawn loss → Brilliant…Blunder)
    registry.ts     # the master game catalogue
    worker.ts       # AI + tutor run in a Web Worker (the UI never janks)
    engineClient.ts # promise-based worker client (with main-thread fallback)
  games/
    chess/          # the flagship: engine, evaluate, search, book, tutor, tutorial
    xiangqi.ts  checkers.ts  draughts.ts  reversi.ts
    connectFour.ts  go.ts  gomoku.ts  pente.ts  ticTacToe.ts
  components/
    Board2D.tsx  Board3D.tsx  TutorPanel.tsx  ThemePicker.tsx  MiniBoard.tsx
  themes/boardThemes.ts   # 200+ templates incl. Liquid Glass
  store/useGameStore.ts   # game session: play, undo/redo, AI driver, passes
  pages/  Home  GameScreen  Learn
```

Because the UI talks only to `GameDefinition`, the 2D board, 3D board, tutor and
AI driver work for **every** game automatically.

---

## 🚀 Run it

```bash
npm install
npm run dev        # development server
npm run build      # production build  → dist/
npm run preview    # preview the build
```

Requires Node 18+.

### Developer tests
```bash
node --experimental-strip-types scripts/perft.ts     # verify chess move-gen (perft)
npx esbuild scripts/gametest.ts --bundle --platform=node --format=esm --outfile=/tmp/gt.mjs && node /tmp/gt.mjs
```

---

## 🛣️ Extending to *any* board game

1. Create `src/games/myGame.ts` implementing `GameDefinition` (use `ticTacToe.ts` as the template).
2. Provide its rules (`getLegalMoves`/`applyMove`/`getStatus`), an AI (`chooseMove` — reuse `searchBestMove`), a tutor (`explainMove`), and a tutorial.
3. Add it to `src/engine/registry.ts`.

That's it — the hub, both boards, all themes, the tutor panel and the learn
page light up for your new game with zero extra UI work.
