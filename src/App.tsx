import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Home from './pages/Home';
import GameScreen from './pages/GameScreen';
import Learn from './pages/Learn';
import Puzzles from './pages/Puzzles';
import Daily from './pages/Daily';
import Openings from './pages/Openings';
import Profile from './pages/Profile';
import Lobby from './pages/Lobby';

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
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/play/:gameId" element={<GameScreen />} />
          <Route path="/learn/:gameId" element={<Learn />} />
          <Route path="/puzzles" element={<Puzzles />} />
          <Route path="/daily" element={<Daily />} />
          <Route path="/openings" element={<Openings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/lobby" element={<Lobby />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </>
  );
}
