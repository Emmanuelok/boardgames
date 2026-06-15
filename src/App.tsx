import { Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import GameScreen from './pages/GameScreen';
import Learn from './pages/Learn';

export default function App() {
  return (
    <>
      <div className="app-bg" />
      <div className="blob a" />
      <div className="blob b" />
      <div className="blob c" />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/play/:gameId" element={<GameScreen />} />
        <Route path="/learn/:gameId" element={<Learn />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
