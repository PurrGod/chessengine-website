// Keep this file UTF-8 encoded (no BOM). If you ever see "Unexpected token" on line 1,
// re-save as UTF-8 and hard-reload.

window.addEventListener("load", function () {
  const statusEl = document.getElementById("status");

  // chess.js game state & rules
  const game = new Chess();

  // chessboard.js UI
  const board = Chessboard("board", {
    draggable: true,
    position: "start",
    // Hosted piece set; you can swap to a local set later if desired
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",

    onDragStart: function (source, piece) {
      if (game.game_over()) return false;
      // You play White; block dragging Black pieces
      if (piece && piece.indexOf("b") === 0) return false;
      return true;
    },

    onDrop: function (source, target) {
      const move = game.move({ from: source, to: target, promotion: "q" });
      if (move === null) return "snapback"; // illegal

      board.position(game.fen());
      updateStatus();

      // Ask backend/engine for reply
      sendMoveToEngine(game.fen())
        .then(function (best) {
          if (!best) return;
          const from = best.slice(0, 2);
          const to = best.slice(2, 4);
          const promo = best[4];

          game.move({ from: from, to: to, promotion: promo });
          board.position(game.fen());
          updateStatus();
        })
        .catch(function (err) {
          console.error(err);
          statusEl.textContent = "Engine error. Check server logs.";
        });
    },
  });

  function updateStatus() {
    if (game.in_checkmate()) {
      statusEl.textContent = "Checkmate!";
    } else if (game.in_draw()) {
      statusEl.textContent = "Draw.";
    } else {
      statusEl.textContent = (game.turn() === "w" ? "White" : "Black") + " to move";
    }
  }

  async function sendMoveToEngine(fen) {
    const resp = await fetch("/api/make-move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fen }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`/api/make-move ${resp.status}: ${text}`);
    }
    const data = await resp.json();
    return data.bestmove;
  }

  updateStatus();
});
