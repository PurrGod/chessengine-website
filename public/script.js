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

/** ===== DOM refs ===== */
const $ = (sel) => document.querySelector(sel);
const statusEl     = () => $('#status');
const timeTopEl    = () => $('#time-top');
const timeBottomEl = () => $('#time-bottom');
const labelTopEl   = () => $('#label-top');
const labelBotEl   = () => $('#label-bottom');

const selColor    = () => $('#color');
const selBase     = () => $('#base');
const selInc      = () => $('#inc');
const selTimeMode = () => $('#timeMode');
const selMoveT    = () => $('#movetime');

const btnStart = () => $('#start');
const btnReset = () => $('#reset');
const btnFlip  = () => $('#flip');

const fenInput    = () => $('#fenInput');
const selAnMoveT  = () => $('#anMovetime');
const btnAnalyze  = () => $('#analyze');
const anResult    = () => $('#anResult');

/** ===== Clock helpers ===== */
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

/** ===== Mapping helper ===== */
function applyClockOrderForHuman() {
  // Always show opponent on top, YOU on bottom
  if (human === 'w') { topSide = 'b'; bottomSide = 'w'; }
  else               { topSide = 'w'; bottomSide = 'b'; }

  labelTopEl().textContent = topSide === 'w' ? 'White' : 'Black';
  labelBotEl().textContent = bottomSide === 'w' ? 'White' : 'Black';
  renderClocks();
}

/** ===== Board setup ===== */
function initBoard() {
  game = new Chess();
  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    orientation: human === 'w' ? 'white' : 'black',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
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

      // Human increment after move
      remaining[human] += incSec * 1000;

      board.position(game.fen());
      updateStatus();

      // Engine thinks -> tick its clock
      startEngineClock();
      engineMove(game.fen());
    },
  });
  updateStatus();
}

/** ===== Status text ===== */
function updateStatus(msg) {
  if (msg) { statusEl().textContent = msg; return; }
  if (game.in_checkmate()) statusEl().textContent = 'Checkmate!';
  else if (game.in_draw()) statusEl().textContent = 'Draw.';
  else statusEl().textContent = (game.turn()==='w'?'White':'Black') + ' to move';
}

/** ===== Engine bridge ===== */
async function engineMove(fen) {
  try {
    const body = { fen };
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
    game.move({ from, to, promotion: promo });
    board.position(game.fen());
    updateStatus();

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
}

function resetGame() {
  gameStarted = false;      // <- clocks will not run until Start
  stopAllClocks();

  game.reset();
  board.orientation(human === 'w' ? 'white' : 'black');
  board.start();

  remaining = { w: baseSec*1000, b: baseSec*1000 };
  renderClocks();
  updateStatus('Ready');
  applyClockOrderForHuman();
}

function startGame() {
  gameStarted = true;
  updateStatus();

  if (human !== game.turn()) {
    // Engine to move first
    startEngineClock();
    engineMove(game.fen());
  }
}

function wireUI() {
  btnStart().addEventListener('click', () => {
    applySettingsFromUI();
    resetGame();
    startGame();
  });

  btnReset().addEventListener('click', () => {
    applySettingsFromUI();
    resetGame(); // remain in "Ready" — no clocks running
  });

  btnFlip().addEventListener('click', () => {
    // Flip board only; clock order remains YOU on bottom
    board.flip();
  });

  selTimeMode().addEventListener('change', () => {
    engineTimeMode = selTimeMode().value;
    const row = document.getElementById('movetimeRow');
    if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';
  });

  // Analysis tool (independent)
  btnAnalyze().addEventListener('click', async () => {
    const fen = fenInput().value.trim();
    const movetime = parseInt(selAnMoveT().value, 10) || 1000;
    if (!fen) { anResult().textContent = 'Please paste a FEN.'; return; }
    anResult().textContent = 'Thinking…';
    try {
      const resp = await fetch('/api/bestmove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, movetime })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      anResult().textContent = data.bestmove ? `bestmove ${data.bestmove}` : 'No bestmove returned';
    } catch (e) {
      console.error(e);
      anResult().textContent = 'Engine error. Check server logs.';
    }
  });
}

/** ===== Boot ===== */
window.addEventListener('load', () => {
  console.log('[boot] Chess:', typeof window.Chess,
              'jQuery:', typeof window.jQuery,
              'Chessboard:', typeof window.Chessboard);

  // Initial render & wiring
  applySettingsFromUI();
  renderClocks();
  initBoard();
  wireUI();

  // Do NOT start any clocks here; they start after pressing Start
});
