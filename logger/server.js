// server.js  — single-file CSV logger with auto-create + GET
// run: node server.js
const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT = 3010;
const LOG_FILE = path.join(__dirname, "mss-log.csv");

// our canonical header (keep in sync with widget + report)
const HEADER = [
  "timestamp",
  "ip",
  "userId",
  "fileName",
  "lengthSec",
  "submitTime",
  "toefl",
  "ielts",
  "pte",
  "cefr",
  "question",
  "transcript",
  "wpm"
].join(",");

// make sure file exists (idempotent)
function ensureLogFile() {
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, HEADER + "\n", "utf8");
  }
}

// quote for CSV, flattening HTML/newlines
function csvSafe(v) {
  if (v === undefined || v === null) return "";
  const s = String(v)
    .replace(/\r?\n/g, " ")
    .replace(/"/g, '""');
  return `"${s}"`;
}

const server = http.createServer((req, res) => {
  const { method, url } = req;

  // health
  if (method === "GET" && url.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // fetch current CSV
  if (method === "GET" && url.startsWith("/log")) {
    ensureLogFile();
    try {
      const data = fs.readFileSync(LOG_FILE, "utf8");
      res.writeHead(200, {
        "Content-Type": "text/csv",
        "Access-Control-Allow-Origin": "*"  // allow report.html
      });
      return res.end(data);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      return res.end("could not read log");
    }
  }

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  // append to CSV
  if (method === "POST" && url.startsWith("/log")) {
    ensureLogFile();

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      let data = {};
      try { data = JSON.parse(body || "{}"); } catch (_) {}

      const row = [
        csvSafe(data.timestamp || new Date().toISOString()),
        csvSafe(data.ip || (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || ""),
        csvSafe(data.userId || ""),
        csvSafe(data.fileName || ""),
        csvSafe(data.lengthSec || ""),
        csvSafe(data.submitTime || ""),
        csvSafe(data.toefl || ""),
        csvSafe(data.ielts || ""),
        csvSafe(data.pte || ""),
        csvSafe(data.cefr || ""),
        csvSafe(data.question || ""),
        csvSafe(data.transcript || ""),
        csvSafe(data.wpm || "")
      ].join(",");

      fs.appendFile(LOG_FILE, row + "\n", err => {
        if (err) {
          res.writeHead(500, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          });
          return res.end(JSON.stringify({ ok: false, error: "write_failed" }));
        }
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        });
        res.end(JSON.stringify({ ok: true, file: "mss-log.csv" }));
        console.log(`✅ logged ${data.fileName || "(no name)"} → ${LOG_FILE}`);
      });
    });
    return;
  }

  // fallback
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, () => {
  ensureLogFile();
  console.log(`✅ Logger (single-file) running on http://localhost:${PORT}/log  (health: /health)`);
  console.log(`➡ Writing to: ${LOG_FILE}`);
});