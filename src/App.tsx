import { Suspense, lazy, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Sidebar from './components/Sidebar';
import RewardToast from './components/RewardToast';
import ErrorBoundary, { type ErrorBoundaryFallbackProps } from './components/ErrorBoundary';
import { hydrateEntitlements } from './billing/billing';
import ConnectivityBadge from './pwa/ConnectivityBadge';

// Every page beyond the landing pulls in the game registry (all engines, AIs and
// tutorials), so we code-split them: the shell + landing load a tiny bundle and
// the rest arrives on navigation.
const GameScreen = lazy(() => import('./pages/GameScreen'));
const Games = lazy(() => import('./pages/Games'));
const Path = lazy(() => import('./pages/Path'));
const StrategyStudio = lazy(() => import('./pages/StrategyStudio'));
const Learn = lazy(() => import('./pages/Learn'));
const Puzzles = lazy(() => import('./pages/Puzzles'));
const Daily = lazy(() => import('./pages/Daily'));
const Openings = lazy(() => import('./pages/Openings'));
const ReviewHub = lazy(() => import('./pages/ReviewHub'));
const Profile = lazy(() => import('./pages/Profile'));
const Lobby = lazy(() => import('./pages/Lobby'));
const Shop = lazy(() => import('./pages/Shop'));
const StrategyOS = lazy(() => import('./pages/StrategyOS'));
const IntelligenceLab = lazy(() => import('./pages/IntelligenceLab'));
const Adventures = lazy(() => import('./pages/Adventures'));
const Community = lazy(() => import('./pages/Community'));
const CreatorStudio = lazy(() => import('./pages/CreatorStudio'));
const Scanner = lazy(() => import('./pages/Scanner'));
const Settings = lazy(() => import('./pages/Settings'));
const Spectate = lazy(() => import('./pages/Spectate'));
const MindGames = lazy(() => import('./pages/MindGames'));
const MindCascade = lazy(() => import('./pages/MindCascade'));

function RouteFailure({ reset }: ErrorBoundaryFallbackProps) {
  return (
    <section
      className="glass"
      role="alert"
      style={{ maxWidth: 620, margin: '48px auto', padding: 28, textAlign: 'center' }}
    >
      <div aria-hidden="true" style={{ fontSize: 38 }}>↻</div>
      <h1 style={{ margin: '8px 0' }}>This view hit a snag</h1>
      <p className="muted">Retry the view, or return home and continue elsewhere.</p>
      <div className="row gap-sm wrap" style={{ justifyContent: 'center', marginTop: 18 }}>
        <button className="btn primary" type="button" onClick={reset}>Try again</button>
        <Link className="btn" to="/" onClick={reset}>Return home</Link>
      </div>
    </section>
  );
}

export default function App() {
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  // If a billing backend is configured (VITE_API_BASE), sync server entitlements
  // (e.g. Pro) on load. No-op otherwise — see src/billing/billing.ts.
  useEffect(() => { void hydrateEntitlements(); }, []);
  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    const frame = requestAnimationFrame(() => {
      document.getElementById('main')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView(); }}>Skip to content</a>
      <div className="app-bg" aria-hidden="true" />
      <div className="blob a" aria-hidden="true" />
      <div className="blob b" aria-hidden="true" />
      <div className="blob c" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div className="shell">
        <Sidebar />
        <main id="main" tabIndex={-1} className="shell-main">
          <ErrorBoundary
            fallback={(props) => <RouteFailure {...props} />}
            resetKeys={[location.pathname, location.search]}
          >
            <Suspense fallback={<div className="route-loading" role="status" aria-live="polite">Loading view…</div>}>
              <div className="route-fade" key={location.pathname}>
                <Routes location={location}>
                  <Route path="/" element={<Home />} />
                  <Route path="/path" element={<Path />} />
                  <Route path="/studio" element={<StrategyStudio />} />
                  <Route path="/games" element={<Games />} />
                  <Route path="/mind-games" element={<MindGames />} />
                  <Route path="/mind-games/cascade" element={<MindCascade />} />
                  <Route path="/play/:gameId" element={<GameScreen />} />
                  <Route path="/learn/:gameId" element={<Learn />} />
                  <Route path="/puzzles" element={<Puzzles />} />
                  <Route path="/daily" element={<Daily />} />
                  <Route path="/openings" element={<Openings />} />
                  <Route path="/reviews" element={<ReviewHub />} />
                  <Route path="/profile" element={<Profile />} />
                  <Route path="/lobby" element={<Lobby />} />
                  <Route path="/shop" element={<Shop />} />
                  <Route path="/os" element={<StrategyOS />} />
                  <Route path="/intelligence" element={<IntelligenceLab />} />
                  <Route path="/adventures" element={<Adventures />} />
                  <Route path="/community" element={<Community />} />
                  <Route path="/creator" element={<CreatorStudio />} />
                  <Route path="/scanner" element={<Scanner />} />
                  <Route path="/scan" element={<Navigate to="/scanner" replace />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/watch/:broadcastId" element={<Spectate />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <RewardToast />
      <ConnectivityBadge />
    </>
  );
}
