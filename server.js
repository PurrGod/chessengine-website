const express = require("express");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3001;

/* ------------ Middleware ------------ */
app.use(express.json());

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// Expose node_modules as /vendor (for chessboard.js, jquery, chess.js)
app.use("/vendor", express.static(path.join(__dirname, "node_modules")));

/* ------------ Health check ------------ */
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, port: PORT, time: new Date().toISOString() });
});

/* ------------ Engine listing ------------ */
app.get("/api/engines", (_req, res) => {
  const engineDir = path.join(__dirname, "engine");
  fs.readdir(engineDir, { withFileTypes: true }, (err, entries) => {
    if (err) {
      console.error("Failed to read engine directory:", err);
      return res.status(500).json({ error: "Failed to read engine directory" });
    }
    // Return regular files (exclude dotfiles and obvious docs)
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => !name.startsWith(".") && !name.toLowerCase().endsWith(".md"));
    res.json(files);
  });
});

/* ------------ UCI runner ------------ */
/** Supports fixed movetime OR clocks (wtime/btime/winc/binc).
 *  Parses 'info' lines for eval + PV and normalizes eval to White’s POV using `turn`.
 *  Pass a specific engine via { engine: "my_engine_binary" } or default to "chess_engine".
 */
function runUci({ fen, movetime, timing, turn, engine }, res) {
  const enginePath = path.join(__dirname, "engine", engine || "chess_engine");
  const eng = spawn(enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });

  let buf = "";
  let lastInfo = { score: null, pv: null };
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    try { eng.stdin.end(); } catch {}
    try { eng.kill(); } catch {}
    clearTimeout(to);
  };

  eng.stdout.on("data", (d) => {
    const s = d.toString();
    buf += s;

    // Track latest 'info' line
    s.split(/\r?\n/).forEach((line) => {
      if (!line.startsWith("info ")) return;
      const mMate = line.match(/\bscore\s+mate\s+(-?\d+)/);
      const mCp   = line.match(/\bscore\s+cp\s+(-?\d+)/);
      const mPv   = line.match(/\bpv\s+(.+)$/);
      if (mMate) lastInfo.score = { type: "mate", value: parseInt(mMate[1], 10) };
      else if (mCp) lastInfo.score = { type: "cp", value: parseInt(mCp[1], 10) };
      if (mPv) lastInfo.pv = mPv[1].trim();
    });

    const m = buf.match(/\bbestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (m) {
      // Normalize eval to White POV (positive = good for White)
      let norm = null;
      if (lastInfo.score) {
        norm = lastInfo.score.type === "cp"
          ? { type: "cp", value: (turn === "w") ? lastInfo.score.value : -lastInfo.score.value }
          : { type: "mate", value: (turn === "w") ? lastInfo.score.value : -lastInfo.score.value };
      }
      if (!res.headersSent) res.json({ bestmove: m[1], eval: norm, pv: lastInfo.pv });
      finish();
    }
  });

  eng.stderr.on("data", (d) => console.error("[engine stderr]", d.toString()));
  eng.on("error", (err) => {
    console.error("[engine error]", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to start engine", detail: String(err) });
    finish();
  });

  const timeoutMs = timing?.mode === "clock"
    ? 30000
    : Math.max(4000, (movetime || 1000) + 2000);

  const to = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "Engine timeout" });
    finish();
  }, timeoutMs);

  // UCI handshake + search
  eng.stdin.write("uci\n");
  eng.stdin.write("isready\n");
  eng.stdin.write("ucinewgame\n");
  eng.stdin.write(`position fen ${fen}\n`);

  if (timing?.mode === "clock") {
    const wtime = Math.max(0, timing.wtime | 0);
    const btime = Math.max(0, timing.btime | 0);
    const winc  = Math.max(0, timing.winc  | 0);
    const binc  = Math.max(0, timing.binc  | 0);
    eng.stdin.write(`go wtime ${wtime} btime ${btime} winc ${winc} binc ${binc}\n`);
  } else {
    eng.stdin.write(`go movetime ${Math.max(50, (movetime | 0) || 1000)}\n`);
  }
}

/* ------------ API endpoints ------------ */
app.post("/api/make-move", (req, res) => {
  const { fen, movetime, timing, turn, engine } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });
  runUci({ fen, movetime, timing, turn, engine }, res);
});

app.post("/api/bestmove", (req, res) => {
  const { fen, movetime, turn, engine } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });
  runUci({ fen, movetime, turn, engine }, res);
});

/* ------------ SPA fallback (keep last) ------------ */
app.use((_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* ------------ Start server (keep at bottom) ------------ */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
