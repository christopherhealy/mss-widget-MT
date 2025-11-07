// server.js (ESM, works with "type": "module")
import express from "express";
import { insertSubmission } from "./db.js";
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


/* ---------- LOGGING ENDPOINT MT---------- */

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

// APPEND new log (widget uses this)
// Also mirrors into Postgres (multi-tenant DB) when DATABASE_URL is set
app.post("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const headers = LOG_HEADERS;

    // best-effort IP capture
    const rawIp =
      (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "") + "";
    const ip = rawIp.split(",")[0].trim();
    body.ip = ip;

    // --- write to CSV (for existing report UI) ---
    const rowValues = headers.map((h) => body[h] ?? "");
    const line = rowValues.map(csvEscape).join(",") + "\n";

    let prefix = "";
    try {
      await fs.access(LOG_CSV);
    } catch {
      // file doesn’t exist yet → write header row
      prefix = headers.join(",") + "\n";
    }
    await fs.appendFile(LOG_CSV, prefix + line, "utf8");

    // --- ALSO write to Postgres (non-fatal if it fails) ---
    let dbOk = false;
    let dbError = null;

    if (process.env.DATABASE_URL) {
      try {
        await insertSubmission({
          school_id: body.schoolId || 1, // demo school for now
          assessment_id: body.assessmentId || null,
          student_id: body.studentId || null,
          teacher_id: body.teacherId || null,
          ip,
          record_count: body.recordCount ?? null,
          file_name: body.fileName ?? null,
          length_sec: body.lengthSec ?? null,
          submit_time: body.submitTime ?? null,
          toefl: body.toefl ?? null,
          ielts: body.ielts ?? null,
          pte: body.pte ?? null,
          cefr: body.cefr ?? null,
          question: body.question ?? null,
          transcript: body.transcript ?? null,
          wpm: body.wpm ?? null,
          meta: body.meta || null,
        });
        dbOk = true;
      } catch (err) {
        console.error("DB insert error:", err);
        dbError = err.message || String(err);
      }
    }

    // tell the client what happened
    res.json({ ok: true, dbOk, dbError });
  } catch (e) {
    console.error("POST /log/submission error:", e);
    res.status(500).json({ ok: false, error: "log failed" });
  }
});

// UPDATE a single CSV row (used by Report UI when teacher edits notes)
app.put("/log/submission", async (req, res) => {
  try {
    const body = req.body || {};
    const id = Number(body.id);
    const updates = body.updates || {};

    if (!Number.isInteger(id) || id < 0) {
      return res
        .status(400)
        .json({ ok: false, error: "id (row index) is required" });
    }
    if (!updates || typeof updates !== "object") {
      return res
        .status(400)
        .json({ ok: false, error: "updates object is required" });
    }

    let csv;
    try {
      csv = await fs.readFile(LOG_CSV, "utf8");
    } catch {
      return res.status(404).json({ ok: false, error: "log file not found" });
    }

    const trimmed = csv.trim();
    if (!trimmed) {
      return res
        .status(400)
        .json({ ok: false, error: "log is empty or only has header" });
    }

    const lines = trimmed.split(/\r?\n/);
    if (lines.length < 2) {
      return res
        .status(400)
        .json({ ok: false, error: "log is empty or only has header" });
    }

    const headers = parseCsvLine(lines[0]);
    const rowLines = lines.slice(1).filter((l) => l.trim() !== "");

    if (id >= rowLines.length) {
      return res.status(400).json({ ok: false, error: "row id out of range" });
    }

    const parsedRows = rowLines.map((line) => parseCsvLine(line));

    const targetCols = parsedRows[id];
    const rowObj = {};
    headers.forEach((h, i) => {
      rowObj[h] = targetCols[i] ?? "";
    });

    // apply updates only for known headers
    Object.entries(updates).forEach(([key, val]) => {
      if (headers.includes(key)) {
        rowObj[key] = val == null ? "" : String(val);
      }
    });

    const updatedCols = headers.map((h) => rowObj[h] ?? "");
    parsedRows[id] = updatedCols;

    const outLines = [
      headers.join(","), // keep existing header
      ...parsedRows.map((cols) => cols.map(csvEscape).join(",")),
    ];

    await fs.writeFile(LOG_CSV, outLines.join("\n") + "\n", "utf8");

    res.json({ ok: true });
  } catch (e) {
    console.error("PUT /log/submission error:", e);
    res.status(500).json({ ok: false, error: "failed to update log" });
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