const express = require("express");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = 3001;
const HOST = "127.0.0.1";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/vendor", express.static(path.join(__dirname, "node_modules")));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, host: HOST, port: PORT, time: new Date().toISOString() });
});

/** UCI runner: supports movetime OR clocks (wtime/btime/winc/binc)
 *  Parses 'info' for eval + PV and normalizes eval to White's POV using 'turn'.
 */
function runUci({ fen, movetime, timing, turn }, res) {
  const enginePath = path.join(__dirname, "engine", "chess_engine"); // adjust if your binary name differs
  const eng = spawn(enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });

  let buf = "";
  let lastInfo = { score: null, pv: null }; // raw score as reported by engine (side-to-move POV)
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    try { eng.stdin.end(); } catch {}
    try { eng.kill(); } catch {}
    clearTimeout(to);
  };

  eng.stdout.on("data", d => {
    const s = d.toString();
    buf += s;

    // Track latest 'info' line
    s.split(/\r?\n/).forEach(line => {
      if (line.startsWith("info ")) {
        const mMate = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const mCp   = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mPv   = line.match(/\bpv\s+(.+)$/);
        if (mMate) lastInfo.score = { type: "mate", value: parseInt(mMate[1], 10) };
        else if (mCp) lastInfo.score = { type: "cp", value: parseInt(mCp[1], 10) };
        if (mPv) lastInfo.pv = mPv[1].trim();
      }
    });

    const m = buf.match(/\bbestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (m) {
      // normalize eval to White POV (positive = good for White)
      let norm = null;
      if (lastInfo.score) {
        if (lastInfo.score.type === "cp") {
          norm = { type: "cp", value: (turn === 'w') ? lastInfo.score.value : -lastInfo.score.value };
        } else {
          // mate in N for side-to-move -> flip if Black to move
          norm = { type: "mate", value: (turn === 'w') ? lastInfo.score.value : -lastInfo.score.value };
        }
      }
      if (!res.headersSent) res.json({ bestmove: m[1], eval: norm, pv: lastInfo.pv });
      finish();
    }
  });

  eng.stderr.on("data", d => console.error("[engine stderr]", d.toString()));
  eng.on("error", err => {
    console.error("[engine error]", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to start engine", detail: String(err) });
    finish();
  });

  const timeoutMs = timing?.mode === 'clock'
    ? 30000
    : Math.max(4000, (movetime || 1000) + 2000);

  const to = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "Engine timeout" });
    finish();
  }, timeoutMs);

  // UCI
  eng.stdin.write("uci\n");
  eng.stdin.write("isready\n");
  eng.stdin.write("ucinewgame\n");
  eng.stdin.write(`position fen ${fen}\n`);

  if (timing?.mode === 'clock') {
    const wtime = Math.max(0, timing.wtime|0);
    const btime = Math.max(0, timing.btime|0);
    const winc  = Math.max(0, timing.winc|0);
    const binc  = Math.max(0, timing.binc|0);
    eng.stdin.write(`go wtime ${wtime} btime ${btime} winc ${winc} binc ${binc}\n`);
  } else {
    eng.stdin.write(`go movetime ${Math.max(50, movetime|0 || 1000)}\n`);
  }
}

app.post("/api/make-move", (req, res) => {
  const { fen, movetime, timing, turn } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });
  runUci({ fen, movetime, timing, turn }, res);
});

app.post("/api/bestmove", (req, res) => {
  const { fen, movetime, turn } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });
  runUci({ fen, movetime, turn }, res);
});

// SPA fallback (keep last)
app.use((_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
