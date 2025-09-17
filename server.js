const express = require("express");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = 3001;
const HOST = "127.0.0.1";

/* ---------- Middleware ---------- */

// JSON body parsing
app.use(express.json());

// Serve your static frontend
app.use(express.static(path.join(__dirname, "public")));

// Serve node_modules as /vendor so we can import libs without copying
app.use("/vendor", express.static(path.join(__dirname, "node_modules")));

/* ---------- Health check ---------- */

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, host: HOST, port: PORT, time: new Date().toISOString() });
});

/* ---------- UCI Engine API ---------- */

app.post("/api/make-move", (req, res) => {
  const { fen } = req.body || {};
  if (!fen) return res.status(400).json({ error: "Missing 'fen' in body" });

  const enginePath = path.join(__dirname, "engine", "chess_engine");
  const engine = spawn(enginePath, [], { stdio: ["pipe", "pipe", "pipe"] });

  let buffer = "";
  let finished = false;

  const cleanup = () => {
    if (finished) return;
    finished = true;
    try { engine.stdin.end(); } catch {}
    try { engine.kill(); } catch {}
    clearTimeout(timer);
  };

  engine.stdout.on("data", (data) => {
    const chunk = data.toString();
    buffer += chunk;
    // console.log("[engine]", chunk); // uncomment for debugging

    const m = buffer.match(/\bbestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (m) {
      if (!res.headersSent) res.json({ bestmove: m[1] });
      cleanup();
    }
  });

  engine.stderr.on("data", (d) => {
    console.error("[engine stderr]", d.toString());
  });

  engine.on("error", (err) => {
    console.error("[engine error]", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to start engine", detail: String(err) });
    cleanup();
  });

  engine.on("exit", (code, signal) => {
    // console.log(`[engine exit] code=${code} signal=${signal}`);
  });

  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(504).json({ error: "Engine timeout" });
    cleanup();
  }, 8000);

  // UCI handshake + search
  engine.stdin.write("uci\n");
  engine.stdin.write("isready\n");
  engine.stdin.write("ucinewgame\n");
  engine.stdin.write(`position fen ${fen}\n`);
  engine.stdin.write("go movetime 1000\n");
});

/* ---------- SPA fallback (Express v5-safe) ---------- */
// Must be last: serve index.html for any unmatched GET
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* ---------- Start ---------- */
app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
