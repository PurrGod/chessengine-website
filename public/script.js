// UTF-8 (no BOM).

/** ===== State ===== */
let game, board;

// Sides
let human = 'w';
let engineSide = 'b';

// Time settings
let baseSec = 300;
let incSec  = 0;
let engineMoveTime = 1000;
let engineTimeMode = 'movetime'; // 'movetime' | 'clock'

// Clocks (ms)
let remaining = { w: 300000, b: 300000 };
let tickHuman = null;
let tickEngine = null;
let active = null;      // 'w' or 'b'
let gameStarted = false;

// Which side is shown top/bottom in the UI
let topSide = 'b';
let bottomSide = 'w';

// Last move highlight + click-to-move selection
let lastMoveSquares = null;
let clickFrom = null;

// History replay for Back/Forward
let playedMoves = [];   // array of UCI strings
let redoStack  = [];    // array of UCI strings

/** ===== DOM helpers ===== */
const qs = (sel) => document.querySelector(sel);

const appGrid      = () => qs('#appGrid');
const statusEl     = () => qs('#status');
const timeTopEl    = () => qs('#time-top');
const timeBottomEl = () => qs('#time-bottom');
const labelTopEl   = () => qs('#label-top');
const labelBotEl   = () => qs('#label-bottom');

const selColor    = () => qs('#color');
const selBase     = () => qs('#base');
const selInc      = () => qs('#inc');
const selTimeMode = () => qs('#timeMode');
const selMoveT    = () => qs('#movetime');

const btnStart = () => qs('#start');
const btnReset = () => qs('#reset');
const btnFlip  = () => qs('#flip');

const fenInput    = () => qs('#fenInput');
const selAnMoveT  = () => qs('#anMovetime');
const btnAnalyze  = () => qs('#analyze');
const anResult    = () => qs('#anResult');

const btnBack     = () => qs('#btnBack');
const btnFwd      = () => qs('#btnFwd');
const btnResign   = () => qs('#btnResign');

/** ===== Layout & Board size ===== */
function setBoardSize(px) {
  document.documentElement.style.setProperty('--board-size', px + 'px');
  document.documentElement.style.setProperty('--left-col', (px + 32) + 'px');
  // If the viewport can't fit board + right pane, stack columns
  const needed = px + 420 + 64; // board pane + right pane + gaps
  if (window.innerWidth < needed) appGrid().classList.add('stacked');
  else appGrid().classList.remove('stacked');
  // Resize board UI
  if (board) board.resize();
}

/** ===== Clocks ===== */
function fmt(ms) {
  const s  = Math.max(0, Math.floor(ms/1000));
  const m  = Math.floor(s/60);
  const ss = (s%60).toString().padStart(2,'0');
  return `${m}:${ss}`;
}
function renderClocks() {
  timeTopEl().textContent    = fmt(remaining[topSide]);
  timeBottomEl().textContent = fmt(remaining[bottomSide]);
}
function stopHumanClock() { if (tickHuman) { clearInterval(tickHuman); tickHuman = null; } if (active === human) active = null; }
function stopEngineClock() { if (tickEngine) { clearInterval(tickEngine); tickEngine = null; } if (active === engineSide) active = null; }
function stopAllClocks() { stopHumanClock(); stopEngineClock(); }

function startHumanClock() {
  if (!gameStarted) return;
  stopEngineClock();
  if (tickHuman) clearInterval(tickHuman);
  active = human;
  let last = performance.now();
  tickHuman = setInterval(() => {
    const now = performance.now();
    const d = now - last; last = now;
    remaining[human] = Math.max(0, remaining[human] - d);
    renderClocks();
    if (remaining[human] <= 0) {
      stopHumanClock();
      statusEl().textContent = (human === 'w' ? 'White' : 'Black') + ' flagged!';
    }
  }, 100);
}

function startEngineClock() {
  if (!gameStarted) return;
  stopHumanClock();
  if (tickEngine) clearInterval(tickEngine);
  active = engineSide;
  let last = performance.now();
  tickEngine = setInterval(() => {
    const now = performance.now();
    const d = now - last; last = now;
    remaining[engineSide] = Math.max(0, remaining[engineSide] - d);
    renderClocks();
    if (remaining[engineSide] <= 0) {
      stopEngineClock();
      statusEl().textContent = (engineSide === 'w' ? 'White' : 'Black') + ' flagged!';
    }
  }, 100);
}

/** ===== Clock layout ===== */
function applyClockOrderForHuman() {
  // You are always at the bottom
  if (human === 'w') { topSide = 'b'; bottomSide = 'w'; }
  else               { topSide = 'w'; bottomSide = 'b'; }

  labelTopEl().textContent = topSide === 'w' ? 'White' : 'Black';
  labelBotEl().textContent = bottomSide === 'w' ? 'White' : 'Black';
  renderClocks();
}

/** ===== Move list / highlights / eval UI ===== */
function uciFromMoveObj(m) {
  return m.from + m.to + (m.promotion ? m.promotion : '');
}

function highlightLastMove(from, to) {
  // remove old
  if (lastMoveSquares) {
    const oldFrom = qs(`#board .square-${lastMoveSquares.from}`); if (oldFrom) oldFrom.classList.remove('square-Highlight');
    const oldTo   = qs(`#board .square-${lastMoveSquares.to}`);   if (oldTo)   oldTo.classList.remove('square-Highlight');
  }
  // add new
  if (from && to) {
    const elFrom = qs(`#board .square-${from}`); if (elFrom) elFrom.classList.add('square-Highlight');
    const elTo   = qs(`#board .square-${to}`);   if (elTo)   elTo.classList.add('square-Highlight');
    lastMoveSquares = { from, to };
  }
}

function clearClickSelect() {
  if (clickFrom) {
    const el = qs(`#board .square-${clickFrom}`);
    if (el) el.classList.remove('square-Selected');
    clickFrom = null;
  }
}

function setClickSelect(sq) {
  clearClickSelect();
  const el = qs(`#board .square-${sq}`);
  if (el) el.classList.add('square-Selected');
  clickFrom = sq;
}

function sanMovesHtml() {
  const hist = game.history({ verbose: true });
  let html = '';
  for (let i = 0; i < hist.length; i += 2) {
    const n = Math.floor(i / 2) + 1;
    const w = hist[i]   ? hist[i].san   : '';
    const b = hist[i+1] ? hist[i+1].san : '';
    html += `<span class="ply"><span class="num">${n}.</span>${w} ${b}</span>`;
  }
  return html || '—';
}
function setMovesUI() { qs('#moves').innerHTML = sanMovesHtml(); }

function setEvalUI(e) {
  const evalText = qs('#evalText');
  const fill     = qs('#evalFill');

  if (!e) {
    evalText.textContent = '—';
    fill.style.width = '50%';
    return;
  }
  if (e.type === 'mate') {
    evalText.textContent = `#${e.value}`;
    const pct = e.value > 0 ? 90 : 10;
    fill.style.width = `${pct}%`;
  } else {
    // e.value is centipawns from White POV (server normalized)
    const cp = Math.max(-800, Math.min(800, e.value)); // clamp for UI
    const pct = Math.round(50 + (cp / 16));            // 160 cp -> ~10%
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    evalText.textContent = (cp >= 0 ? '+' : '') + (cp/100).toFixed(2);
  }
}

function pvUciToSan(fen, pv) {
  if (!pv) return '—';
  try {
    const g = new Chess(fen);
    const toks = pv.trim().split(/\s+/);
    const out = [];
    for (const u of toks) {
      const from = u.slice(0,2), to = u.slice(2,4), promo = u[4];
      const m = g.move({ from, to, promotion: promo });
      if (!m) break;
      out.push(m.san);
    }
    return out.join(' ');
  } catch { return pv; }
}

/** ===== Board ===== */
function initBoard() {
  game = new Chess();

  // initial board size and layout
  const size = parseInt(qs('#boardSize').value, 10) || 480;
  setBoardSize(size);

  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    orientation: human === 'w' ? 'white' : 'black',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    showNotation: true,
    onDragStart: (src, piece) => {
      if (!gameStarted) return false;
      if (game.game_over()) return false;
      if (game.turn() !== human) return false;
      if (piece && piece[0] !== (human === 'w' ? 'w' : 'b')) return false;
      return true;
    },
    onDrop: (source, target) => {
      const move = game.move({ from: source, to: target, promotion: 'q' });
      if (move === null) return 'snapback';

      // Clear redo if new branch
      redoStack.length = 0;

      // Record UCI
      playedMoves.push(uciFromMoveObj(move));

      // Increment for human after move
      remaining[human] += incSec * 1000;

      board.position(game.fen());
      highlightLastMove(source, target);
      clearClickSelect();
      setMovesUI();
      setEvalUI(null);
      qs('#pvText').textContent = '—';
      updateStatus();

      // Engine thinks -> tick its clock
      startEngineClock();
      engineMove(game.fen(), game.turn());
    },
  });

  // Click-to-move via delegated events
  // Squares have classes like "square-55d63 square-e2", so extract [a-h][1-8]
  $(document).off('click', '#board .square-55d63');
  $(document).on('click', '#board .square-55d63', function () {
    if (!gameStarted) return;
    const cls = this.className.split(/\s+/).find(c => /^square-[a-h][1-8]$/.test(c));
    if (!cls) return;
    const sq = cls.slice(7);

    if (game.turn() !== human) return;

    if (!clickFrom) {
      const p = game.get(sq);
      if (p && p.color === (human === 'w' ? 'w' : 'b')) {
        setClickSelect(sq);
      }
      return;
    } else {
      if (sq === clickFrom) { clearClickSelect(); return; }

      const move = game.move({ from: clickFrom, to: sq, promotion: 'q' });
      clearClickSelect();

      if (move === null) {
        // allow changing selection to another friendly piece
        const p2 = game.get(sq);
        if (p2 && p2.color === (human === 'w' ? 'w' : 'b')) setClickSelect(sq);
        return;
      }

      // Clear redo if new branch
      redoStack.length = 0;

      playedMoves.push(uciFromMoveObj(move));
      remaining[human] += incSec * 1000;

      board.position(game.fen());
      highlightLastMove(move.from, move.to);
      setMovesUI();
      setEvalUI(null);
      qs('#pvText').textContent = '—';
      updateStatus();

      startEngineClock();
      engineMove(game.fen(), game.turn());
    }
  });

  updateStatus();
}

/** ===== Status ===== */
function updateStatus(msg) {
  if (msg) { statusEl().textContent = msg; return; }
  if (game.in_checkmate()) statusEl().textContent = 'Checkmate!';
  else if (game.in_draw()) statusEl().textContent = 'Draw.';
  else statusEl().textContent = (game.turn()==='w'?'White':'Black') + ' to move';
}

/** ===== Engine bridge ===== */
async function engineMove(fen, turnToMove) {
  try {
    const body = { fen, turn: turnToMove || (fen.includes(' w ') ? 'w' : 'b') };
    if (engineTimeMode === 'movetime') {
      body.movetime = engineMoveTime;
    } else {
      body.timing = {
        mode: 'clock',
        wtime: Math.round(remaining.w),
        btime: Math.round(remaining.b),
        winc: incSec * 1000,
        binc: incSec * 1000
      };
    }

    const resp = await fetch('/api/make-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    const best = data.bestmove;
    if (!best) throw new Error('No bestmove');

    // Engine finished thinking
    stopEngineClock();

    const from = best.slice(0,2), to = best.slice(2,4), promo = best[4];
    const m = game.move({ from, to, promotion: promo });
    board.position(game.fen());
    highlightLastMove(from, to);
    updateStatus();

    // record engine move UCI
    playedMoves.push(uciFromMoveObj(m));

    // Move list + eval/PV
    setMovesUI();
    if (data.eval) setEvalUI(data.eval); else setEvalUI(null);
    const pvSan = data.pv ? pvUciToSan(game.fen(), data.pv) : '—';
    qs('#pvText').textContent = pvSan;

    // Engine increment
    remaining[engineSide] += incSec * 1000;
    renderClocks();

    if (!game.game_over() && game.turn() === human) startHumanClock();
  } catch (e) {
    console.error(e);
    stopEngineClock();
    updateStatus('Engine error. Check server logs.');
  }
}

/** ===== Controls ===== */
function applySettingsFromUI() {
  human = selColor().value;
  engineSide = (human === 'w') ? 'b' : 'w';

  baseSec = parseInt(selBase().value, 10);
  incSec  = parseInt(selInc().value, 10);

  engineTimeMode = selTimeMode().value;
  engineMoveTime = parseInt(selMoveT().value, 10);

  remaining = { w: baseSec*1000, b: baseSec*1000 };
  applyClockOrderForHuman();

  // Show/hide movetime row
  const row = document.getElementById('movetimeRow');
  if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';

  // Persist settings
  localStorage.setItem('chess.settings', JSON.stringify({
    color: human, base: baseSec, inc: incSec,
    timeMode: engineTimeMode, movetime: engineMoveTime,
    boardSize: parseInt(qs('#boardSize').value, 10)
  }));
}

function resetGame() {
  gameStarted = false;
  stopAllClocks();
  lastMoveSquares = null;
  clearClickSelect();
  playedMoves = [];
  redoStack = [];

  game.reset();
  board.orientation(human === 'w' ? 'white' : 'black');
  board.start();

  remaining = { w: baseSec*1000, b: baseSec*1000 };
  renderClocks();
  setMovesUI();
  setEvalUI(null);
  qs('#pvText').textContent = '—';
  updateStatus('Ready');
  applyClockOrderForHuman();
}

function startGame() {
  gameStarted = true;
  updateStatus();

  if (human !== game.turn()) {
    // Engine to move first
    startEngineClock();
    engineMove(game.fen(), game.turn());
  }
}

function goBackOnePly() {
  if (playedMoves.length === 0) return;
  // pause clocks while navigating
  stopAllClocks(); gameStarted = false;

  const last = playedMoves.pop();
  redoStack.push(last);

  // rebuild game from start
  const startFEN = "startpos";
  game.reset();
  for (const u of playedMoves) {
    const from = u.slice(0,2), to = u.slice(2,4), promo = u[4];
    game.move({ from, to, promotion: promo });
  }
  board.position(game.fen(), false);
  setMovesUI();
  setEvalUI(null);
  qs('#pvText').textContent = '—';

  // update last move highlight
  const hist = game.history({ verbose: true });
  if (hist.length) {
    const lm = hist[hist.length - 1];
    highlightLastMove(lm.from, lm.to);
  } else {
    highlightLastMove(null, null);
  }
  updateStatus('Paused');
}

function goForwardOnePly() {
  if (redoStack.length === 0) return;
  const next = redoStack.pop();
  playedMoves.push(next);

  const from = next.slice(0,2), to = next.slice(2,4), promo = next[4];
  game.move({ from, to, promotion: promo });
  board.position(game.fen(), false);
  setMovesUI();
  updateStatus('Paused');

  const hist = game.history({ verbose: true });
  const lm = hist[hist.length - 1];
  highlightLastMove(lm.from, lm.to);
}

function resign() {
  stopAllClocks();
  gameStarted = false;
  updateStatus((human==='w' ? 'White' : 'Black') + ' resigns.');
}

/** ===== Wire UI ===== */
function wireUI() {
  qs('#boardSize').addEventListener('input', (e) => {
    const px = parseInt(e.target.value, 10);
    setBoardSize(px);
  });

  btnStart().addEventListener('click', () => {
    applySettingsFromUI();
    resetGame();
    startGame();
  });

  btnReset().addEventListener('click', () => {
    applySettingsFromUI();
    resetGame(); // remain "Ready"
  });

  btnFlip().addEventListener('click', () => board.flip());

  selTimeMode().addEventListener('change', () => {
    engineTimeMode = selTimeMode().value;
    const row = document.getElementById('movetimeRow');
    if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';
  });

  // Moves tools
  qs('#btnCopyFEN').addEventListener('click', () =>
    navigator.clipboard.writeText(game.fen()).then(() => updateStatus('FEN copied.'))
  );
  qs('#btnCopyPGN').addEventListener('click', () => {
    const pgn = game.pgn();
    navigator.clipboard.writeText(pgn).then(() => updateStatus('PGN copied.'));
  });
  qs('#btnDownloadPGN').addEventListener('click', () => {
    const blob = new Blob([game.pgn()], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `game-${Date.now()}.pgn`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  qs('#btnPause').addEventListener('click', () => { stopAllClocks(); updateStatus('Paused'); });
  qs('#btnResume').addEventListener('click', () => {
    if (!gameStarted) return;
    if (game.turn() === human) startHumanClock(); else startEngineClock();
  });
  btnBack().addEventListener('click', goBackOnePly);
  btnFwd().addEventListener('click',  goForwardOnePly);
  btnResign().addEventListener('click', resign);

  // Analysis tool (independent)
  qs('#analyze').addEventListener('click', async () => {
    const fen = fenInput().value.trim();
    const movetime = parseInt(selAnMoveT().value, 10) || 1000;
    if (!fen) { anResult().textContent = 'Please paste a FEN.'; return; }
    anResult().textContent = 'Thinking…';
    try {
      // compute side-to-move from FEN to normalize eval
      const turn = fen.includes(' w ') ? 'w' : 'b';
      const resp = await fetch('/api/bestmove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, movetime, turn })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const best = data.bestmove || '(none)';
      const pvSan = data.pv ? pvUciToSan(fen, data.pv) : '—';
      anResult().textContent = `bestmove ${best} | eval ${data.eval ? (data.eval.type==='mate' ? ('#'+data.eval.value) : ( (data.eval.value>=0?'+':'')+(data.eval.value/100).toFixed(2) )) : '—'} | pv ${pvSan}`;
    } catch (e) {
      console.error(e);
      anResult().textContent = 'Engine error. Check server logs.';
    }
  });
}

/** ===== Boot ===== */
window.addEventListener('load', () => {
  // Restore saved settings if any
  const saved = localStorage.getItem('chess.settings');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      if (s.color)     selColor().value = s.color;
      if (s.base)      selBase().value = String(s.base);
      if (s.inc!=null) selInc().value = String(s.inc);
      if (s.timeMode)  selTimeMode().value = s.timeMode;
      if (s.movetime)  selMoveT().value = String(s.movetime);
      if (s.boardSize) {
        const slider = qs('#boardSize'); slider.value = s.boardSize;
        setBoardSize(parseInt(s.boardSize, 10));
      } else {
        setBoardSize(parseInt(qs('#boardSize').value, 10) || 480);
      }
    } catch {
      setBoardSize(parseInt(qs('#boardSize').value, 10) || 480);
    }
  } else {
    setBoardSize(parseInt(qs('#boardSize').value, 10) || 480);
  }

  // Initial render & wiring
  applySettingsFromUI();
  renderClocks();
  initBoard();
  wireUI();

  // Do NOT start any clocks here; they start after pressing Start.
});

window.addEventListener('resize', () => {
  // keep layout sane on resize
  const px = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--board-size')) || 480;
  setBoardSize(px);
});
