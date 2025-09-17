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

function runUci({ fen, movetime, timing }, res) {
  const enginePath = path.join(__dirname, "engine", "chess_engine");
  const eng = spawn(enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });

  let buf = "";
  let done = false;
  const finish = () => { if (done) return; done = true; try{eng.stdin.end();}catch{} try{eng.kill();}catch{} clearTimeout(to); };

  eng.stdout.on("data", d => {
    const s = d.toString();
    buf += s;
    const m = buf.match(/\bbestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (m) { if (!res.headersSent) res.json({ bestmove: m[1] }); finish(); }
  });
  eng.stderr.on("data", d => console.error("[engine stderr]", d.toString()));
  eng.on("error", err => { console.error("[engine error]", err); if (!res.headersSent) res.status(500).json({ error:"Failed to start engine", detail:String(err) }); finish(); });
  eng.on("exit", (c,s) => { /* console.log('exit', c, s); */ });

  const timeoutMs = timing?.mode === 'clock'
    ? 30000  // plenty for clock mode; engine manages time
    : Math.max(4000, (movetime || 1000) + 2000);
  const to = setTimeout(() => { if (!res.headersSent) res.status(504).json({ error:"Engine timeout" }); finish(); }, timeoutMs);

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
  const { fen, movetime, timing } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });
  runUci({ fen, movetime, timing }, res);
});

app.post("/api/bestmove", (req, res) => {
  const { fen, movetime } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });
  runUci({ fen, movetime }, res);
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
