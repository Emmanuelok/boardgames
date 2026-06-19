import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Sidebar from './components/Sidebar';
import RewardToast from './components/RewardToast';

// Every page beyond the landing pulls in the game registry (all engines, AIs and
// tutorials), so we code-split them: the shell + landing load a tiny bundle and
// the rest arrives on navigation.
const GameScreen = lazy(() => import('./pages/GameScreen'));
const Learn = lazy(() => import('./pages/Learn'));
const Puzzles = lazy(() => import('./pages/Puzzles'));
const Daily = lazy(() => import('./pages/Daily'));
const Openings = lazy(() => import('./pages/Openings'));
const ReviewHub = lazy(() => import('./pages/ReviewHub'));
const Profile = lazy(() => import('./pages/Profile'));
const Lobby = lazy(() => import('./pages/Lobby'));
const Shop = lazy(() => import('./pages/Shop'));

export default function App() {
  const location = useLocation();
  return (
    <>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.focus(); m?.scrollIntoView(); }}>Skip to content</a>
      <div className="app-bg" />
      <div className="blob a" />
      <div className="blob b" />
      <div className="blob c" />
      <div className="grain" />
      <div className="shell">
        <Sidebar />
        <main id="main" tabIndex={-1} className="shell-main">
          <Suspense fallback={<div className="route-loading">Loading…</div>}>
            <div className="route-fade" key={location.pathname}>
              <Routes location={location}>
                <Route path="/" element={<Home />} />
                <Route path="/games" element={<Navigate to="/" replace />} />
                <Route path="/play/:gameId" element={<GameScreen />} />
                <Route path="/learn/:gameId" element={<Learn />} />
                <Route path="/puzzles" element={<Puzzles />} />
                <Route path="/daily" element={<Daily />} />
                <Route path="/openings" element={<Openings />} />
                <Route path="/reviews" element={<ReviewHub />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/lobby" element={<Lobby />} />
                <Route path="/shop" element={<Shop />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Suspense>
        </main>
      </div>
      <RewardToast />
    </>
  );
}
