// server.js (ESM, works with "type": "module")
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, "src");
const PUBLIC_DIR = path.join(ROOT, "public");
const THEMES_DIR = path.join(ROOT, "themes");

// CSV log in /tmp (ephemeral on free Render)
const LOG_CSV = "/tmp/msswidget-log.csv";
const LOG_HEADERS = [
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
  "wpm",
  "recordCount",
  "teacher",
  "note",
];

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- middleware ---------- */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-ADMIN-KEY", "API-KEY", "X-API-SECRET"],
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Static files
app.use(express.static(PUBLIC_DIR));
app.use("/themes", express.static(path.join(PUBLIC_DIR, "themes")));
app.use("/themes", express.static(THEMES_DIR));

/* ---------- helpers ---------- */
async function ensureSrcDir() {
  try {
    await fs.mkdir(SRC_DIR, { recursive: true });
  } catch {}
}

async function readJson(rel, fallback = {}) {
  await ensureSrcDir();
  const full = path.join(SRC_DIR, rel);
  try {
    const txt = await fs.readFile(full, "utf8");
    return JSON.parse(txt);
  } catch {
    await fs.writeFile(full, JSON.stringify(fallback, null, 2), "utf8");
    return fallback;
  }
}

async function writeJson(rel, obj) {
  await ensureSrcDir();
  const full = path.join(SRC_DIR, rel);
  await fs.writeFile(full, JSON.stringify(obj ?? {}, null, 2), "utf8");
}

/* ---------- defaults ---------- */
const defaultForm = {
  headline: "Practice TOEFL Speaking Test",
  recordButton: "Record your response",
  previousButton: "Previous",
  nextButton: "Next",
  uploadButton: "Choose an audio file",
  stopButton: "Stop",
  poweredByLabel: "Powered by MSS Vox",
  NotRecordingLabel: "Not recording",
  SubmitForScoringButton: "Submit for scoring",
  survey: [],
};

const defaultConfig = {
  editable: {
    headline: true,
    recordButton: true,
    previousButton: true,
    nextButton: true,
    poweredByLabel: true,
    uploadButton: true,
    stopButton: true,
    NotRecordingLabel: true,
    SubmitForScoringButton: true,
  },
  theme: "apple",
  api: { enabled: true, baseUrl: "", key: "", secret: "" },
  logger: { enabled: false, url: "" },
  audioMinSeconds: 30,
  audioMaxSeconds: 61,
};

const defaultImages = { logoDataUrl: "" };

/* ---------- ADMIN KEY ---------- */
const ADMIN_WRITE_KEY = process.env.ADMIN_WRITE_KEY || "";
function checkAdminKey(req, res) {
  if (!ADMIN_WRITE_KEY) return true;
  const header = req.header("X-ADMIN-KEY");
  if (header && header === ADMIN_WRITE_KEY) return true;
  res.status(401).json({ ok: false, error: "admin unauthorized" });
  return false;
}

/* ---------- CONFIG ROUTES ---------- */
app.get("/config/forms", async (req, res) => {
  try {
    const data = await readJson("form.json", defaultForm);
    res.json(data);
  } catch (e) {
    console.error("GET /config/forms error:", e);
    res.status(500).json({ error: "failed to read forms" });
  }
});

app.put("/config/forms", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    await writeJson("form.json", req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /config/forms error:", e);
    res.status(500).json({ ok: false, error: "failed to write forms" });
  }
});

app.get("/config/widget", async (req, res) => {
  try {
    const data = await readJson("config.json", defaultConfig);
    res.json(data);
  } catch (e) {
    console.error("GET /config/widget error:", e);
    res.status(500).json({ error: "failed to read widget config" });
  }
});

app.put("/config/widget", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    await writeJson("config.json", req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /config/widget error:", e);
    res.status(500).json({ ok: false, error: "failed to write widget config" });
  }
});

app.get("/config/images", async (req, res) => {
  try {
    const data = await readJson("image.json", defaultImages);
    res.json(data);
  } catch (e) {
    console.error("GET /config/images error:", e);
    res.status(500).json({ error: "failed to read images" });
  }
});

app.put("/config/images", async (req, res) => {
  if (!checkAdminKey(req, res)) return;
  try {
    await writeJson("image.json", req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /config/images error:", e);
    res.status(500).json({ ok: false, error: "failed to write images" });
  }
});

/* ---------- LOGGING ENDPOINT ---------- */
function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

// APPEND new log
app.post("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const headers = LOG_HEADERS;

    // best-effort IP capture
    const rawIp =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "") + "";
    const ip = rawIp.split(",")[0].trim();
    body.ip = ip;

    const rowValues = headers.map((h) => body[h] ?? "");
    const line = rowValues.map(csvEscape).join(",") + "\n";

    let prefix = "";
    try {
      await fs.access(LOG_CSV);
    } catch {
      prefix = headers.join(",") + "\n";
    }
    await fs.appendFile(LOG_CSV, prefix + line, "utf8");
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /log/submission error:", e);
    res.status(500).json({ ok: false, error: "log failed" });
  }
});

// READ all logs
app.get("/log/submissions", async (req, res) => {
  try {
    let csv;
    try {
      csv = await fs.readFile(LOG_CSV, "utf8");
    } catch {
      return res.json({ headers: [], rows: [] });
    }
    const trimmed = csv.trim();
    if (!trimmed) return res.json({ headers: [], rows: [] });

    const lines = trimmed.split(/\r?\n/);
    const headers = parseCsvLine(lines[0]);
    const rows = lines
      .slice(1)
      .filter((l) => l.trim())
      .map((line, idx) => {
        const cols = parseCsvLine(line);
        const row = { id: idx };
        headers.forEach((h, i) => (row[h] = cols[i] ?? ""));
        return row;
      });
    res.json({ headers, rows });
  } catch (e) {
    console.error("GET /log/submissions error:", e);
    res.status(500).json({ ok: false, error: "failed to read log" });
  }
});

// UPDATE single log row
app.put("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const id = Number(body.id);
    const updates = body.updates || {};
    if (!Number.isInteger(id) || id < 0)
      return res.status(400).json({ ok: false, error: "invalid id" });

    let csv;
    try {
      csv = await fs.readFile(LOG_CSV, "utf8");
    } catch {
      return res.status(404).json({ ok: false, error: "log not found" });
    }

    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2)
      return res.status(400).json({ ok: false, error: "log empty" });

    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(parseCsvLine);
    if (id >= rows.length)
      return res.status(400).json({ ok: false, error: "out of range" });

    const current = rows[id];
    const rowObj = {};
    headers.forEach((h, i) => (rowObj[h] = current[i] ?? ""));
    Object.entries(updates).forEach(([k, v]) => {
      if (headers.includes(k)) rowObj[k] = v == null ? "" : String(v);
    });

    rows[id] = headers.map((h) => rowObj[h] ?? "");
    const out = [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
    await fs.writeFile(LOG_CSV, out.join("\n") + "\n", "utf8");
    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /log/submission error:", e);
    res.status(500).json({ ok: false, error: "update failed" });
  }
});

/* ---------- health ---------- */
app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/* ---------- start ---------- */
app.listen(PORT, () => {
  console.log(`✅ MSS Widget service listening on port ${PORT}`);
});