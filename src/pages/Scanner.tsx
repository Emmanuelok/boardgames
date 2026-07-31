import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { SCANNER_GAMES, scannerGame } from '../scanner/games';
import { decodeBoardImage, sampleBoardImage } from '../scanner/imagePipeline';
import { createScanDraft, saveScanDraft } from '../scanner/positionDraft';
import type { ScanCell, ScanToken } from '../scanner/types';
import type { Player } from '../engine/types';
import './Scanner.css';

const EMPTY_TOKEN: ScanToken = { occupant: 'empty', kind: '' };

function tokenKey(token: ScanToken): string {
  return `${token.occupant}:${token.kind}`;
}

function cellGlyph(cell: ScanToken, gameId: string): string {
  if (cell.occupant === 'empty') return '·';
  if (gameId === 'tic-tac-toe') return cell.occupant === 'player0' ? 'X' : 'O';
  const game = scannerGame(gameId);
  const piece = game.pieceKinds.find((kind) => kind.id === cell.kind) ?? game.pieceKinds[0];
  return piece?.glyph ?? '●';
}

export default function Scanner() {
  const [gameId, setGameId] = useState('chess');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [inset, setInset] = useState(3);
  const [cells, setCells] = useState<ScanCell[]>([]);
  const [selectedToken, setSelectedToken] = useState<ScanToken>(EMPTY_TOKEN);
  const [turn, setTurn] = useState<Player>(0);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<ReturnType<typeof createScanDraft> | null>(null);
  const analysisRequest = useRef(0);
  const game = scannerGame(gameId);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const tokens = useMemo(() => {
    const out: Array<ScanToken & { label: string }> = [{ ...EMPTY_TOKEN, label: 'Empty' }];
    for (const occupant of ['player0', 'player1'] as const) {
      for (const kind of game.pieceKinds) {
        out.push({
          occupant,
          kind: kind.id,
          label: `${game.playerNames[occupant === 'player0' ? 0 : 1]} ${kind.label}`,
        });
      }
    }
    return out;
  }, [game]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    analysisRequest.current += 1;
    setWorking(false);
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setCells([]);
    setSaved(null);
    setMessage(next ? 'Photo ready. Align the crop and sample the board.' : '');
  };

  const analyze = async () => {
    if (!file) {
      setMessage('Choose or take a board photo first.');
      return;
    }
    const request = ++analysisRequest.current;
    const requestedFile = file;
    const requestedGame = game;
    setWorking(true);
    setSaved(null);
    setMessage('Sampling the board on this device…');
    try {
      const decoded = await decodeBoardImage(requestedFile);
      if (request !== analysisRequest.current) return;
      const crop = { top: inset / 100, right: inset / 100, bottom: inset / 100, left: inset / 100 };
      const result = sampleBoardImage(decoded.imageData, requestedGame, crop);
      if (request !== analysisRequest.current) return;
      setCells(result.cells);
      setSelectedToken(EMPTY_TOKEN);
      const confidence = Math.round(result.averageConfidence * 100);
      setMessage(
        `Sampling complete · ${confidence}% average confidence · ${result.lowConfidenceCount} square${result.lowConfidenceCount === 1 ? '' : 's'} need careful review.`,
      );
    } catch (error) {
      if (request !== analysisRequest.current) return;
      setMessage(error instanceof Error ? error.message : 'The photo could not be sampled.');
    } finally {
      if (request === analysisRequest.current) setWorking(false);
    }
  };

  const updateCell = (index: number) => {
    setCells((current) => current.map((cell) => (
      cell.index === index
        ? { ...cell, ...selectedToken, confidence: 1 }
        : cell
    )));
    setSaved(null);
  };

  const save = () => {
    if (cells.length !== game.rows * game.cols) {
      setMessage('Sample the whole board before saving.');
      return;
    }
    const draft = createScanDraft(game, cells, turn);
    if (!saveScanDraft(draft)) {
      setMessage('The position could not be saved in this browser session.');
      return;
    }
    setSaved(draft);
    setMessage('Position saved locally. The photograph itself was not saved.');
  };

  const gridStyle = {
    '--scan-cols': game.cols,
    '--scan-rows': game.rows,
  } as CSSProperties;
  const cropStyle = {
    inset: `${inset}%`,
    backgroundSize: `${100 / game.cols}% ${100 / game.rows}%`,
  } as CSSProperties;

  return (
    <div className="scanner-page">
      <header className="scanner-hero">
        <span className="eyebrow">Physical companion</span>
        <h1>Bring a real board into GrandMaster</h1>
        <p>
          Take a straight overhead photo, review the on-device estimate, and correct every uncertain square.
          Photos never leave the browser and are discarded when you close this page.
        </p>
      </header>

      <section className="scanner-flow" aria-label="Board scan workflow">
        <div className="scanner-panel glass">
          <div className="scanner-step"><b>1</b><span>Choose the board</span></div>
          <label className="scanner-field">
            <span>Game and board size</span>
            <select
              value={gameId}
              onChange={(event) => {
                analysisRequest.current += 1;
                setGameId(event.target.value);
                setWorking(false);
                setCells([]);
                setSaved(null);
                setTurn(0);
                setSelectedToken(EMPTY_TOKEN);
              }}
            >
              {SCANNER_GAMES.map((option) => (
                <option value={option.id} key={option.id}>{option.name}</option>
              ))}
            </select>
          </label>
          <p className="scanner-note">{game.notes}</p>

          <div className="scanner-step"><b>2</b><span>Take or choose a photo</span></div>
          <label className="scanner-upload">
            <input type="file" accept="image/*" capture="environment" onChange={chooseFile} />
            <span aria-hidden="true">▣</span>
            <strong>{file ? 'Replace board photo' : 'Open camera or files'}</strong>
            <small>JPG, PNG or WebP · up to 18 MB</small>
          </label>

          {previewUrl ? (
            <>
              <div className="scanner-preview">
                <img src={previewUrl} alt="Selected physical board" />
                <div className="scanner-crop-grid" style={cropStyle} aria-hidden="true" />
              </div>
              <label className="scanner-range">
                <span>Edge inset <strong>{inset}%</strong></span>
                <input
                  type="range"
                  min="0"
                  max="18"
                  step="1"
                  value={inset}
                  onChange={(event) => {
                    analysisRequest.current += 1;
                    setWorking(false);
                    setInset(Number(event.target.value));
                    setCells([]);
                    setSaved(null);
                    setMessage('Crop changed. Sample the board again to verify this framing.');
                  }}
                />
                <small>Move the guide until its outer lines match the playable board.</small>
              </label>
              <button type="button" className="btn primary" disabled={working} onClick={analyze}>
                {working ? 'Sampling…' : 'Sample board on this device'}
              </button>
            </>
          ) : null}
        </div>

        <div className="scanner-panel glass">
          <div className="scanner-step"><b>3</b><span>Verify the position</span></div>
          {cells.length ? (
            <>
              <div className="scanner-tools" role="toolbar" aria-label="Piece correction tools">
                {tokens.map((token) => (
                  <button
                    type="button"
                    key={`${token.occupant}-${token.kind}`}
                    className={tokenKey(selectedToken) === tokenKey(token) ? 'on' : ''}
                    aria-pressed={tokenKey(selectedToken) === tokenKey(token)}
                    onClick={() => setSelectedToken({ occupant: token.occupant, kind: token.kind })}
                    title={token.label}
                  >
                    <span className={`scan-tool-glyph ${token.occupant}`}>
                      {cellGlyph(token, game.id)}
                    </span>
                    <small>{token.label}</small>
                  </button>
                ))}
              </div>

              <div
                className={`scanner-board ${game.rows > 10 ? 'dense' : ''}`}
                style={gridStyle}
                role="grid"
                aria-label={`${game.name} scanned position. Choose a tool, then activate a square to correct it.`}
              >
                {cells.map((cell) => {
                  const fileLabel = String.fromCharCode(65 + cell.col);
                  const label = `${fileLabel}${game.rows - cell.row}`;
                  const player = cell.occupant === 'player0' ? game.playerNames[0]
                    : cell.occupant === 'player1' ? game.playerNames[1]
                      : 'empty';
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      key={cell.index}
                      className={`${cell.occupant} ${cell.confidence < 0.55 ? 'uncertain' : ''}`}
                      onClick={() => updateCell(cell.index)}
                      aria-label={`${label}, ${player}${cell.kind ? ` ${cell.kind}` : ''}, ${Math.round(cell.confidence * 100)}% confidence`}
                      title={`${label} · ${player} · ${Math.round(cell.confidence * 100)}% confidence`}
                    >
                      <span>{cellGlyph(cell, game.id)}</span>
                    </button>
                  );
                })}
              </div>

              <div className="scanner-save-row">
                <label className="scanner-field">
                  <span>Side to move</span>
                  <select
                    value={turn}
                    onChange={(event) => {
                      setTurn(Number(event.target.value) as Player);
                      setSaved(null);
                      setMessage('Side to move changed. Save the verified position again.');
                    }}
                  >
                    <option value={0}>{game.playerNames[0]}</option>
                    <option value={1}>{game.playerNames[1]}</option>
                  </select>
                </label>
                <button type="button" className="btn primary" onClick={save}>Save verified position</button>
              </div>
            </>
          ) : (
            <div className="scanner-empty">
              <span aria-hidden="true">⌗</span>
              <h2>Your correction board will appear here</h2>
              <p>The scanner only proposes a position. You always approve the final pieces and side to move.</p>
            </div>
          )}

          {saved ? (
            <aside className="scanner-summary" aria-label="Saved position summary">
              <strong>Saved position</strong>
              <span>{saved.gameName} · {game.playerNames[0]} to move: {saved.turn === 0 ? 'yes' : 'no'}</span>
              <span>{game.playerNames[0]} {saved.summary.player0} · {game.playerNames[1]} {saved.summary.player1} · {saved.summary.empty} empty</span>
              <small>Only the verified board data is held in session storage. No photograph is retained.</small>
              <Link className="btn primary sm scanner-open-position" to={`/play/${saved.gameId}?scan=latest`}>
                Open verified position
              </Link>
            </aside>
          ) : null}
          <p className="scanner-status" role="status" aria-live="polite">{message}</p>
        </div>
      </section>

      <section className="scanner-trust glass-soft">
        <div><strong>On-device</strong><span>Canvas sampling runs locally with no upload endpoint.</span></div>
        <div><strong>Human verified</strong><span>Low-confidence cells are outlined and every piece can be corrected.</span></div>
        <div><strong>History aware</strong><span>Rules that a photo cannot prove are clearly reset instead of guessed.</span></div>
      </section>
    </div>
  );
}
