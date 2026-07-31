# ♛ GrandMaster — Adaptive School of Strategy

**One connected learning system for players who want to understand strategy—not merely finish games.**

GrandMaster connects **38 complete game engines**, lessons, adaptive practice,
fair AI sparring and post-game review through one learner model. The new
**Strategy Path** turns evidence from every session into a clear next move while
the underlying engines remain deterministic and rules-verified.

![stack](https://img.shields.io/badge/React-18-61dafb) ![stack](https://img.shields.io/badge/TypeScript-5-3178c6) ![stack](https://img.shields.io/badge/Three.js-3D-000000) ![stack](https://img.shields.io/badge/Vite-8-646cff)

---

## ✨ One platform, one learning loop

The experience is organized around five coordinated specialists that share the
same profile, progression, match, puzzle and review evidence:

1. **Diagnostician** — identifies the most useful current focus.
2. **Curriculum Guide** — sequences the right lesson and proof position.
3. **Practice Builder** — moves from guided examples to independent solving.
4. **Sparring Director** — selects a fair opponent strength for useful evidence.
5. **Review Analyst** — converts decisive moments into the next session.

This loop is implemented by the pure, tested mission orchestrator in
`src/intelligence/orchestrator.ts` and surfaced through `/path`.

### 🧭 Strategy OS — ten connected platform systems

`/os` is the platform map for a second, evidence-connected layer built on the
same 38 engines:

1. **Replay Lab** preserves bounded serialized positions, engine explanations,
   annotations and drill-worthy turning points from completed games.
2. **Strategy DNA** measures 12 transferable concepts with separate score,
   confidence and evidence counts; unseen skills remain explicitly unmeasured.
3. **Cross-game Training** builds source → bridge → transfer routes from
   authored concept affinities and the platform's actual puzzle availability.
4. **Explainable Coach** cites saved reviews and learner evidence instead of
   inventing variations or pretending an empty profile is fully understood.
5. **Adventure Campaigns** provide three expeditions and nine chapters, each
   completed through the real observe → learn → practise → play → reflect loop.
6. **Clubs, Tournaments & Spectating** add local-first clubs, scheduled tables,
   deterministic brackets, friendly P2P play and read-only live rooms. There
   are no stakes, paid entries, odds or randomized rewards.
7. **Creator Studio** authors engine-validated puzzles, guided courses and
   bounded challenge variants without executable code, custom HTML or CSS.
8. **Physical-board Scanner** samples seven board families locally from a
   photo, exposes confidence per cell and requires human correction before a
   position can enter the game store. Photographs are never persisted.
9. **Accessibility Suite** controls theme, contrast, colour differentiation,
   text scale and spacing, motion, piece patterns and board narration.
10. **Offline-first PWA** installs an app shell, supports safe update prompts
    and can crawl the emitted Vite graph on demand so unvisited lazy routes and
    game artwork remain available without a connection.

The feature domains are intentionally separate (`src/intelligence`,
`src/adventures`, `src/community`, `src/creator`, `src/scanner`,
`src/accessibility`, and `src/pwa`) while sharing the existing learner ledger,
game registry and validated game store. Local payloads are versioned, bounded
and normalized on read.

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

### 🏆 A progression system that rewards every session
Earn **XP, levels and coins** for everything you do — winning (scaled by
difficulty), clean high-accuracy play, solving puzzles, the **Daily Challenge**,
finishing a game's course, unlocking achievements, and discovering new games.
**Daily and weekly quests** rotate and pay out on claim, and a floating reward toast
celebrates every gain. Spend earned coins in the **Collection** on living wallpapers,
titles and avatar frames, or freely swap a daily quest for the next available goal.
Tokens are never sold, quest swaps are deterministic, and supporter status never
changes XP or access to learning tools. See **[MONETIZATION.md](./MONETIZATION.md)**.

---

## 🎲 The 38-engine library

The discovery experience groups close variants into 32 browsable worlds while
preserving all 38 full engines:

- **Royal and directional strategy:** Chess, Xiangqi, Shogi, Tafl, Hexapawn and
  Mū Tōrere.
- **Capture classics:** Checkers, International Draughts, Alquerque, Fox and
  Hounds, Nine Men's Morris, Three Men's Morris, Backgammon and Surakarta.
- **Connection and alignment:** Gomoku, Pente, Connect Four, Tic-Tac-Toe, Hex,
  Pentago, Squava, Teeko and Five Field Kono.
- **Territory, mobility and placement:** Go, Reversi, Amazons, Lines of Action,
  Konane, Clobber, Cohesion, Breakthrough, Domineering and Mancala.
- **Modern abstract systems:** Dots and Boxes, Quarto, Tally, Order and Chaos
  and Ultimate Tic-Tac-Toe.

Every game ships with a **classical, in-depth tutorial** (rules → strategy)
with illustrated positions, and the same move-by-move tutor.

---

## 🏗️ Architecture

The whole center is built on **one universal abstraction**, so adding any board
game in the world is just a matter of implementing a single interface.

```text
src/
  intelligence/
    orchestrator.ts   # one adaptive mission assembled from shared learner evidence
    learningMemory.ts # persisted, ordered evidence ledger for the five-stage loop
    missionRouting.ts # validated mission context shared across every route
  engine/
    types.ts        # GameDefinition — the universal interface every game implements
    ai.ts           # generic alpha-beta search shared by the lighter games
    grade.ts        # move-quality grading (centipawn loss → Brilliant…Blunder)
    registry.ts     # the master game catalogue
    worker.ts       # AI + tutor run in a Web Worker (the UI never janks)
    engineClient.ts # promise-based worker client (with main-thread fallback)
  games/
    chess/          # the flagship: engine, evaluate, search, book, tutor, tutorial
    xiangqi.ts  checkers.ts  draughts.ts  ninemensmorris.ts  reversi.ts
    connectFour.ts  mancala.ts  go.ts  gomoku.ts  pente.ts  hex.ts  ticTacToe.ts
  components/
    Board2D.tsx  Board3D.tsx  JourneyContext.tsx  TutorPanel.tsx  ThemePicker.tsx
  themes/boardThemes.ts   # 200+ templates incl. Liquid Glass
  store/useGameStore.ts   # race-safe session, AI/tutor driver and validated online play
  progression/progression.ts  # XP, levels, coins, daily quests & cosmetic economy
  profile/profile.ts      # player profile, Elo rating & achievements
  pages/  Home  Path  Games  GameScreen  Learn  Daily  Puzzles  Reviews  Profile
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

Requires Node 22.17+ so the build, test and headless-browser toolchain share one supported runtime.

### Deploy (Vercel or Netlify)

The repo ships with config for both — connect it in either dashboard and it
auto-builds on every push (free tier, no settings to change):

- **Vercel** — "Add New Project" → import the repo → Deploy. (`vercel.json` sets
  framework/build/output.)
- **Netlify** — "Add new site" → "Import an existing project" → pick the repo →
  Deploy. (`netlify.toml` sets build command `npm run build` and publish `dist`.)

The app uses relative asset paths and `HashRouter`, so it works at any domain or
sub-path with no extra configuration.

### Developer tests
```bash
npm run typecheck
npm test
npm run build
npm run smoke:thumbnails  # all 32 realistic catalogue images
npm run smoke:expansion   # all ten systems, interactions, PWA and mobile shell
node --experimental-strip-types scripts/perft.ts     # verify chess move generation
```

---

## 🛣️ Extending to *any* board game

1. Create `src/games/myGame.ts` implementing `GameDefinition` (use `ticTacToe.ts` as the template).
2. Provide its rules (`getLegalMoves`/`applyMove`/`getStatus`), an AI (`chooseMove` — reuse `searchBestMove`), a tutor (`explainMove`), and a tutorial.
3. Add it to `src/engine/registry.ts`.

That's it — the hub, both boards, all themes, the tutor panel and the learn
page light up for your new game with zero extra UI work.
