// UTF-8 (no BOM).

/** ===== State & refs ===== */
let game, board;

// Sides
let human = 'w';
let engineSide = 'b';

// Time settings
let baseSec = 300;                // 5 min default
let incSec  = 0;
let engineMoveTime = 1000;        // ms
let engineTimeMode = 'movetime';  // 'movetime' | 'clock'

// Clocks (ms)
let remaining = { w: 300000, b: 300000 };

// Tickers
let tickHuman = null;   // human clock ticker
let tickEngine = null;  // engine clock ticker
let active = null;      // 'w' or 'b'

// Game control
let gameStarted = false; // clocks never run until Start is pressed

// DOM helpers
const $ = (sel) => document.querySelector(sel);
const statusEl = () => $('#status');
const clockElW = () => $('#clock-w');
const clockElB = () => $('#clock-b');

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
  clockElW().textContent = fmt(remaining.w);
  clockElB().textContent = fmt(remaining.b);
}
function stopHumanClock() { if (tickHuman) { clearInterval(tickHuman); tickHuman = null; } if (active === human) active = null; }
function stopEngineClock() { if (tickEngine) { clearInterval(tickEngine); tickEngine = null; } if (active === engineSide) active = null; }
function stopAllClocks() { stopHumanClock(); stopEngineClock(); }

function startHumanClock() {
  if (!gameStarted) return; // only after Start
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
  if (!gameStarted) return; // only after Start
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

/** ===== Board setup ===== */
function initBoard() {
  game = new Chess();
  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    orientation: human === 'w' ? 'white' : 'black',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    onDragStart: (src, piece) => {
      // No moving before Start
      if (!gameStarted) return false;
      if (game.game_over()) return false;
      // Only move on your turn and your color
      if (game.turn() !== human) return false;
      if (piece && piece[0] !== (human === 'w' ? 'w' : 'b')) return false;
      return true;
    },
    onDrop: (source, target) => {
      const move = game.move({ from: source, to: target, promotion: 'q' });
      if (move === null) return 'snapback';

      // Human has moved: add increment to human
      remaining[human] += incSec * 1000;

      board.position(game.fen());
      updateStatus();

      // While engine thinks, tick engine clock
      startEngineClock();

      // Ask engine for reply
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
      // UCI clock mode: provide clocks in ms
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

    // Engine finished thinking: stop its clock first
    stopEngineClock();

    const from = best.slice(0,2), to = best.slice(2,4), promo = best[4];
    game.move({ from, to, promotion: promo });
    board.position(game.fen());
    updateStatus();

    // Add increment to engine after its move
    remaining[engineSide] += incSec * 1000;
    renderClocks();

    // Resume human clock if the game continues
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
  renderClocks();

  // Show/hide movetime row depending on engine mode
  const row = document.getElementById('movetimeRow');
  if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';
}

function resetGame() {
  // Reset should NOT start any clock
  gameStarted = false;
  stopAllClocks();

  game.reset();
  board.orientation(human === 'w' ? 'white' : 'black');
  board.start();

  remaining = { w: baseSec*1000, b: baseSec*1000 };
  renderClocks();
  updateStatus('Ready');
}

function startGame() {
  // Called when pressing Start — this arms the clocks but
  // doesn't start the human clock until White's first move.
  gameStarted = true;
  updateStatus(); // show "White to move" / "Black to move"

  if (human !== game.turn()) {
    // Engine moves first -> tick its clock while it thinks
    startEngineClock();
    engineMove(game.fen());
  }
}

function wireUI() {
  btnStart().addEventListener('click', () => {
    applySettingsFromUI();
    resetGame();   // ensure a clean slate
    startGame();   // arm clocks; engine moves first if human is black
  });

  btnReset().addEventListener('click', () => {
    applySettingsFromUI();
    resetGame();   // stop clocks, set Ready; do NOT start anything
  });

  btnFlip().addEventListener('click', () => {
    board.flip();
  });

  selTimeMode().addEventListener('change', () => {
    engineTimeMode = selTimeMode().value;
    const row = document.getElementById('movetimeRow');
    if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';
  });

  // Analysis tool (independent from main game)
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
  // If any of these are undefined, libs aren't loaded and nothing will work.
  console.log('[boot] Chess:', typeof window.Chess,
              'jQuery:', typeof window.jQuery,
              'Chessboard:', typeof window.Chessboard);

  renderClocks();
  initBoard();
  wireUI();
  applySettingsFromUI(); // sync UI -> state

  // IMPORTANT: do NOT start any clock here.
  // Clocks start only after pressing Start:
  //  - If human is white: starts after your first move.
  //  - If human is black: engine starts thinking immediately after Start.
});
