import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Home from './pages/Home';

// Every page beyond the landing pulls in the game registry (all engines, AIs and
// tutorials), so we code-split them: the landing loads a tiny bundle and the rest
// arrives on navigation.
const Games = lazy(() => import('./pages/Games'));
const GameScreen = lazy(() => import('./pages/GameScreen'));
const Learn = lazy(() => import('./pages/Learn'));
const Puzzles = lazy(() => import('./pages/Puzzles'));
const Daily = lazy(() => import('./pages/Daily'));
const Openings = lazy(() => import('./pages/Openings'));
const ReviewHub = lazy(() => import('./pages/ReviewHub'));
const Profile = lazy(() => import('./pages/Profile'));
const Lobby = lazy(() => import('./pages/Lobby'));

export default function App() {
  const location = useLocation();
  return (
    <>
      <div className="app-bg" />
      <div className="blob a" />
      <div className="blob b" />
      <div className="blob c" />
      <div className="blob d" />
      <div className="grain" />
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 0.7, 0.2, 1] }}
      >
        <Suspense fallback={<div className="route-loading">Loading…</div>}>
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/games" element={<Games />} />
            <Route path="/play/:gameId" element={<GameScreen />} />
            <Route path="/learn/:gameId" element={<Learn />} />
            <Route path="/puzzles" element={<Puzzles />} />
            <Route path="/daily" element={<Daily />} />
            <Route path="/openings" element={<Openings />} />
            <Route path="/reviews" element={<ReviewHub />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/lobby" element={<Lobby />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </motion.div>
    </>
  );
}
