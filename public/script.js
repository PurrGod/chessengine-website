// UTF-8 (no BOM).

/** ===== State ===== */
let game, board, historyGame;
let historyIndex = -1;

// Sides
let playerWhite = 'human';
let playerBlack = 'chess_engine';

// Time settings
let baseSec = 300;
let incSec  = 0;
let engineMoveTime = 1000;
let engineTimeMode = 'movetime'; // 'movetime' | 'clock'

// Eval toggle
let showEval = true;

// Clocks (ms)
let remaining = { w: 300000, b: 300000 };
let tickWhite = null;
let tickBlack = null;
let active = null;      // 'w' or 'b'
let gameStarted = false;

// Which side is shown top/bottom in the UI
let topSide = 'b';
let bottomSide = 'w';

// Last move highlight + click-to-move selection + legal marks
let lastMoveSquares = null;
let clickFrom = null;
let legalTargets = []; // list of {to, capture}

/** ===== DOM helpers ===== */
const qs = (sel) => document.querySelector(sel);

const appGrid      = () => qs('#appGrid');
const statusEl     = () => qs('#status');
const timeTopEl    = () => qs('#time-top');
const timeBottomEl = () => qs('#time-bottom');
const labelTopEl   = () => qs('#label-top');
const labelBotEl   = () => qs('#label-bottom');

const selWhiteEngine = () => qs('#whiteEngine');
const selBlackEngine = () => qs('#blackEngine');
const selBase     = () => qs('#base');
const selInc      = () => qs('#inc');
const selTimeMode = () => qs('#timeMode');
const selMoveT    = () => qs('#movetime');
const chkShowEval = () => qs('#showEval');

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

const evalVert      = () => qs('#evalVert');
const evalVertFill  = () => qs('#evalVertFill');
const evalVertText  = () => qs('#evalVertText');

/** ===== Layout & Board size ===== */
function setBoardSize(px) {
  document.documentElement.style.setProperty('--board-size', px + 'px');
  document.documentElement.style.setProperty('--left-col', (px + 72) + 'px');
  const needed = px + 420 + 96;
  if (window.innerWidth < needed) appGrid().classList.add('stacked');
  else appGrid().classList.remove('stacked');
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
function stopClock(side) {
    if (side === 'w') {
        if (tickWhite) { clearInterval(tickWhite); tickWhite = null; }
    } else {
        if (tickBlack) { clearInterval(tickBlack); tickBlack = null; }
    }
}
function stopAllClocks() {
    stopClock('w');
    stopClock('b');
}
function startClock(side) {
    if (!gameStarted) return;
    stopAllClocks();
    active = side;
    let last = performance.now();
    const tick = setInterval(() => {
        const now = performance.now();
        const d = now - last;
        last = now;
        remaining[side] = Math.max(0, remaining[side] - d);
        renderClocks();

        // --- FIX IS HERE ---
        // When time runs out, end the game immediately.
        if (remaining[side] <= 0) {
            stopAllClocks();
            gameStarted = false; // This prevents any more moves.
            statusEl().textContent = (side === 'w' ? 'White' : 'Black') + ' flagged!';
        }
    }, 100);

    if (side === 'w') tickWhite = tick;
    else tickBlack = tick;
}

/** ===== Clock layout ===== */
function applyClockAndBoardOrientation() {
  const humanPlayerColor = playerWhite === 'human' ? 'w' : (playerBlack === 'human' ? 'b' : null);
  const orientation = humanPlayerColor === 'b' ? 'black' : 'white';
  board.orientation(orientation);

  if (orientation === 'white') {
    topSide = 'b';
    bottomSide = 'w';
  } else {
    topSide = 'w';
    bottomSide = 'b';
  }

  labelTopEl().textContent = topSide === 'w' ? 'White' : 'Black';
  labelBotEl().textContent = bottomSide === 'w' ? 'White' : 'Black';
  renderClocks();
}

/** ===== Eval UI (vertical) ===== */
function setEvalUI(e) {
  if (!showEval) return;
  if (!e) {
    evalVertFill().style.height = '50%';
    evalVertText().textContent = '—';
    return;
  }
  if (e.type === 'mate') {
    evalVertText().textContent = `#${e.value}`;
    const pct = e.value > 0 ? 95 : 5;
    evalVertFill().style.height = `${100 - pct}%`;
  } else {
    const cp = Math.max(-800, Math.min(800, e.value));
    const whitePct = Math.max(5, Math.min(95, 50 + (cp / 16)));
    evalVertFill().style.height = `${100 - whitePct}%`;
    evalVertText().textContent = (cp >= 0 ? '+' : '') + (cp/100).toFixed(2);
  }
}

function pvUciToSan(fen, pv) {
  if (!pv) return '—';
  try {
    const g = new Chess(fen);
    const toks = pv.trim().split(/\s+/);
    const out = [];
    for (const u of toks) {
      const {from, to, promotion} = {from: u.slice(0,2), to: u.slice(2,4), promotion: u[4]};
      const m = g.move({ from, to, promotion });
      if (!m) break;
      out.push(m.san);
    }
    return out.join(' ');
  } catch { return pv; }
}

/** ===== Highlights ===== */
function highlightLastMove(from, to) {
  if (lastMoveSquares) {
    const oldFrom = qs(`#board .square-${lastMoveSquares.from}`); if (oldFrom) oldFrom.classList.remove('square-Highlight');
    const oldTo   = qs(`#board .square-${lastMoveSquares.to}`);   if (oldTo)   oldTo.classList.remove('square-Highlight');
  }
  if (from && to) {
    const elFrom = qs(`#board .square-${from}`); if (elFrom) elFrom.classList.add('square-Highlight');
    const elTo   = qs(`#board .square-${to}`);   if (elTo)   elTo.classList.add('square-Highlight');
    lastMoveSquares = { from, to };
  }
}

function clearClickSelect() {
  document.querySelectorAll('#board .square-Selected').forEach(el => el.classList.remove('square-Selected'));
  clickFrom = null;
  clearLegalTargets();
}

function showLegalTargets(fromSq) {
  clearLegalTargets();
  legalTargets = [];
  const moves = game.moves({ square: fromSq, verbose: true });
  for (const mv of moves) {
    const el = qs(`#board .square-${mv.to}`);
    if (!el) continue;
    const cls = mv.flags.includes('c') ? 'square-Capture' : 'square-Target';
    el.classList.add(cls);
    legalTargets.push({ to: mv.to, capture: cls === 'square-Capture' });
  }
}
function clearLegalTargets() {
  for (const {to} of legalTargets) {
    const el = qs(`#board .square-${to}`);
    if (el) { el.classList.remove('square-Target'); el.classList.remove('square-Capture'); }
  }
  legalTargets = [];
}

/** ===== Move list ===== */
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

/** ===== Board ===== */
function initBoard() {
  game = new Chess();
  historyGame = new Chess();
  const size = parseInt(qs('#boardSize').value, 10) || 480;
  setBoardSize(size);

  board = Chessboard('board', {
    draggable: true,
    position: 'start',
    orientation: 'white',
    pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
    showNotation: true,
    onDragStart: (src, piece) => {
        if (!gameStarted || game.game_over()) return false;
        const turn = game.turn();
        const player = turn === 'w' ? playerWhite : playerBlack;
        if (player !== 'human' || piece[0] !== turn) return false;
        clearClickSelect();
        showLegalTargets(src);
        const elFrom = document.querySelector(`#board .square-${src}`);
        if (elFrom) elFrom.classList.add('square-Selected');
        return true;
    },
    onDrop: (source, target) => {
        const move = game.move({ from: source, to: target, promotion: 'q' });
        clearClickSelect();
        if (move === null) return 'snapback';
        handleMove(move);
    },
    onSnapEnd: () => { board.position(game.fen()); }
  });

  $(document).off('click', '#board .square-55d63');
  $(document).on('click', '#board .square-55d63', function () {
    if (!gameStarted || game.game_over()) return;

    const cls = this.className.split(/\s+/).find(c => /^square-[a-h][1-8]$/.test(c));
    if (!cls) return;
    const sq = cls.slice(7);

    const turn = game.turn();
    const player = turn === 'w' ? playerWhite : playerBlack;
    if (player !== 'human') return;

    if (clickFrom) {
        if (sq === clickFrom) {
            clearClickSelect();
            return;
        }
        const move = game.move({ from: clickFrom, to: sq, promotion: 'q' });
        if (move) {
            clearClickSelect();
            handleMove(move);
        } else {
            const piece = game.get(sq);
            if (piece && piece.color === turn) {
                clearClickSelect();
                clickFrom = sq;
                const el = document.querySelector(`#board .square-${sq}`);
                if (el) el.classList.add('square-Selected');
                showLegalTargets(sq);
            } else {
                clearClickSelect();
            }
        }
    } else {
        const piece = game.get(sq);
        if (piece && piece.color === turn) {
            clickFrom = sq;
            const el = document.querySelector(`#board .square-${sq}`);
            if (el) el.classList.add('square-Selected');
            showLegalTargets(sq);
        }
    }
  });
  updateStatus();
}

function handleMove(move) {
    historyGame.move(move);
    historyIndex = -1; // Reset history view on new move
    const turn = game.turn() === 'w' ? 'b' : 'w'; // The player who just moved
    remaining[turn] += incSec * 1000;
    board.position(game.fen());
    highlightLastMove(move.from, move.to);
    setMovesUI();
    updateStatus();
    if (showEval) quickEvalForFen(game.fen());
    if (!game.game_over()) {
        const nextTurn = game.turn();
        const nextPlayer = nextTurn === 'w' ? playerWhite : playerBlack;
        startClock(nextTurn);
        if (nextPlayer !== 'human') {
            engineMove(game.fen(), nextTurn, nextPlayer);
        }
    } else {
        stopAllClocks();
    }
}

/** ===== Status ===== */
function updateStatus(msg) {
  if (msg) { statusEl().textContent = msg; return; }
  if (game.in_checkmate()) statusEl().textContent = 'Checkmate!';
  else if (game.in_draw()) statusEl().textContent = 'Draw.';
  else statusEl().textContent = (game.turn()==='w'?'White':'Black') + ' to move';
}

/** ===== Engine bridge ===== */
async function engineMove(fen, turnToMove, engine) {
  try {
    const body = { fen, turn: turnToMove, engine };
    if (engineTimeMode === 'movetime') {
      body.movetime = engineMoveTime;
    } else {
      body.timing = {
        mode: 'clock',
        wtime: Math.round(remaining.w), btime: Math.round(remaining.b),
        winc: incSec * 1000, binc: incSec * 1000
      };
    }
    const resp = await fetch('/api/make-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(await resp.text());
    const data = await resp.json();
    if (!data.bestmove) throw new Error('No bestmove received');
    if (showEval && data.eval) setEvalUI(data.eval);
    if (data.pv) qs('#pvText').textContent = pvUciToSan(fen, data.pv);
    const { from, to, promotion } = { from: data.bestmove.slice(0,2), to: data.bestmove.slice(2,4), promotion: data.bestmove[4] };
    const m = game.move({ from, to, promotion });
    handleMove(m);
  } catch (e) {
    console.error(e);
    stopClock(turnToMove);
    updateStatus('Engine error. Check server logs.');
  }
}

/** Quick eval helper (does not play a move; small movetime) */
async function quickEvalForFen(fen) {
  try {
    const turn = fen.includes(' w ') ? 'w' : 'b';
    const engine = playerWhite !== 'human' ? playerWhite : playerBlack;
    const resp = await fetch('/api/bestmove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, movetime: 150, turn, engine })
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.eval) setEvalUI(data.eval);
    if (data.pv) qs('#pvText').textContent = pvUciToSan(fen, data.pv);
  } catch {}
}

/** ===== Controls ===== */
function applySettingsFromUI() {
  playerWhite = selWhiteEngine().value;
  playerBlack = selBlackEngine().value;
  baseSec = parseInt(selBase().value, 10);
  incSec  = parseInt(selInc().value, 10);
  engineTimeMode = selTimeMode().value;
  engineMoveTime = parseInt(selMoveT().value, 10);
  showEval = !!chkShowEval().checked;
  evalVert().setAttribute('aria-hidden', showEval ? 'false' : 'true');
  remaining = { w: baseSec*1000, b: baseSec*1000 };
  applyClockAndBoardOrientation();
  const row = document.getElementById('movetimeRow');
  if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';
  localStorage.setItem('chess.settings', JSON.stringify({
    whiteEngine: playerWhite, blackEngine: playerBlack,
    base: baseSec, inc: incSec, timeMode: engineTimeMode, movetime: engineMoveTime,
    boardSize: parseInt(qs('#boardSize').value, 10), showEval
  }));
}

function resetGame() {
  gameStarted = false;
  stopAllClocks();
  lastMoveSquares = null;
  clearClickSelect();
  game.reset();
  historyGame.reset();
  historyIndex = -1;
  applyClockAndBoardOrientation();
  board.start();
  remaining = { w: baseSec*1000, b: baseSec*1000 };
  renderClocks();
  setMovesUI();
  setEvalUI(null);
  qs('#pvText').textContent = '—';
  updateStatus('Ready');
}

function startGame() {
  gameStarted = true;
  updateStatus();
  const turn = game.turn();
  const player = turn === 'w' ? playerWhite : playerBlack;
  startClock(turn);
  if (player !== 'human') {
      engineMove(game.fen(), turn, player);
  }
}

function wireUI() {
  qs('#boardSize').addEventListener('input', (e) => setBoardSize(parseInt(e.target.value, 10)));
  chkShowEval().addEventListener('change', () => {
    showEval = !!chkShowEval().checked;
    evalVert().setAttribute('aria-hidden', showEval ? 'false' : 'true');
  });
  btnStart().addEventListener('click', () => { applySettingsFromUI(); resetGame(); startGame(); });
  btnReset().addEventListener('click', () => { applySettingsFromUI(); resetGame(); });
  btnFlip().addEventListener('click', () => board.flip());
  selTimeMode().addEventListener('change', () => {
    engineTimeMode = selTimeMode().value;
    const row = document.getElementById('movetimeRow');
    if (row) row.style.display = engineTimeMode === 'movetime' ? '' : 'none';
  });
  qs('#btnCopyFEN').addEventListener('click', () => navigator.clipboard.writeText(game.fen()).then(() => updateStatus('FEN copied.')));
  qs('#btnCopyPGN').addEventListener('click', () => navigator.clipboard.writeText(game.pgn()).then(() => updateStatus('PGN copied.')));
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
    if (!gameStarted || game.game_over()) return;
    const turn = game.turn();
    const player = turn === 'w' ? playerWhite : playerBlack;
    startClock(turn);
    if (player !== 'human') {
        engineMove(game.fen(), turn, player);
    }
  });

  qs('#btnBack').addEventListener('click', () => {
    const history = historyGame.history({ verbose: true });
    if (historyIndex === -1) {
        historyIndex = history.length - 1;
    } else {
        historyIndex = Math.max(0, historyIndex - 1);
    }

    if (historyIndex >= 0) {
        const tempGame = new Chess();
        for (let i = 0; i <= historyIndex; i++) {
            tempGame.move(history[i]);
        }
        board.position(tempGame.fen());
    }
  });

  qs('#btnFwd').addEventListener('click', () => {
      const history = historyGame.history({ verbose: true });
      if (historyIndex > -1 && historyIndex < history.length - 1) {
          historyIndex++;
          const tempGame = new Chess();
          for (let i = 0; i <= historyIndex; i++) {
              tempGame.move(history[i]);
          }
          board.position(tempGame.fen());
      } else {
          board.position(game.fen());
          historyIndex = -1;
      }
  });

  qs('#btnResign').addEventListener('click', () => {
    stopAllClocks(); gameStarted = false;
    const turn = game.turn();
    const player = turn === 'w' ? playerWhite : playerBlack;
    if (player === 'human') updateStatus((turn === 'w' ? 'White' : 'Black') + ' resigns.');
  });
  qs('#analyze').addEventListener('click', async () => {
    const fen = fenInput().value.trim();
    if (!fen) { anResult().textContent = 'Please paste a FEN.'; return; }
    anResult().textContent = 'Thinking…';
    try {
      const turn = fen.includes(' w ') ? 'w' : 'b';
      const engine = playerWhite !== 'human' ? playerWhite : playerBlack;
      const movetime = parseInt(selAnMoveT().value, 10) || 1000;
      const resp = await fetch('/api/bestmove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, movetime, turn, engine })
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const pvSan = data.pv ? pvUciToSan(fen, data.pv) : '—';
      const evalStr = data.eval ? (data.eval.type === 'mate' ? `#${data.eval.value}` : `${data.eval.value >= 0 ? '+' : ''}${(data.eval.value/100).toFixed(2)}`) : '—';
      anResult().textContent = `bestmove ${data.bestmove || '(none)'} | eval ${evalStr} | pv ${pvSan}`;
      if (showEval && data.eval) setEvalUI(data.eval);
    } catch (e) {
      console.error(e);
      anResult().textContent = 'Engine error. Check server logs.';
    }
  });
}

/** ===== Boot ===== */
window.addEventListener('load', async () => {
  const engines = await fetch('/api/engines').then(res => res.json());
  const whiteEngineSelect = selWhiteEngine();
  const blackEngineSelect = selBlackEngine();
  engines.forEach(engine => {
      [whiteEngineSelect, blackEngineSelect].forEach(sel => {
        const option = document.createElement('option');
        option.value = engine;
        option.textContent = engine;
        sel.appendChild(option);
      });
  });

  const saved = localStorage.getItem('chess.settings');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      if (s.whiteEngine) selWhiteEngine().value = s.whiteEngine;
      if (s.blackEngine) selBlackEngine().value = s.blackEngine;
      if (s.base) selBase().value = String(s.base);
      if (s.inc != null) selInc().value = String(s.inc);
      if (s.timeMode) selTimeMode().value = s.timeMode;
      if (s.movetime) selMoveT().value = String(s.movetime);
      if (s.boardSize) {
        qs('#boardSize').value = s.boardSize;
        setBoardSize(parseInt(s.boardSize, 10));
      }
      if (typeof s.showEval === 'boolean') chkShowEval().checked = s.showEval;
    } catch {
      setBoardSize(parseInt(qs('#boardSize').value, 10) || 480);
    }
  }

  initBoard();
  applySettingsFromUI();
  renderClocks();
  wireUI();
});

window.addEventListener('resize', () => {
  const px = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--board-size')) || 480;
  setBoardSize(px);
});
